#!/usr/bin/env bash
# Deploy the AWS demo stack (infra/template.yaml) with the credentials in your shell. See docs/aws-runbook.md.
# Required env: AWS_REGION, DEMO_KEY, BEDROCK_MODEL_ID, REVIEW_ORIGIN.
# Optional: ALLOW_REGION=<region> to deploy outside ap-southeast-1 on purpose.
#           SKIP_BEDROCK_CHECK=1 if the model access check misfires (its CLI output is unverified against a real account).
# DEMO_KEY is masked in the output below, but it is passed to sam as an argument, so it shows in the local process list.
set -euo pipefail
cd "$(dirname "$0")/.."
STACK=counter-check-demo
CONFIG="$PWD/infra/samconfig.toml"
export SAM_CLI_TELEMETRY=0

die() { echo "deploy: $*" >&2; exit 1; }
for v in AWS_REGION DEMO_KEY BEDROCK_MODEL_ID REVIEW_ORIGIN; do [[ -n ${!v:-} ]] || die "set $v (see docs/aws-runbook.md)"; done
[[ $AWS_REGION == ap-southeast-1 || ${ALLOW_REGION:-} == "$AWS_REGION" ]] \
  || die "AWS_REGION is $AWS_REGION but this stack targets ap-southeast-1. Set ALLOW_REGION=$AWS_REGION to deploy there on purpose."
[[ $DEMO_KEY =~ ^[A-Za-z0-9_-]{24,}$ ]] || die "DEMO_KEY must be 24 or more letters, digits, _ or - (for example: openssl rand -hex 24)"
[[ $REVIEW_ORIGIN =~ ^https?://[^/[:space:]]+$ ]] || die "REVIEW_ORIGIN must be an origin such as https://demo.example.com (no path, no trailing slash)"
[[ $BEDROCK_MODEL_ID =~ ^[A-Za-z0-9.:_-]+$ ]] || die "BEDROCK_MODEL_ID has unexpected characters"
for c in aws sam node; do command -v "$c" >/dev/null || die "$c is not installed"; done
export -n DEMO_KEY   # child processes get the key only as the one sam deploy argument below
export AWS_DEFAULT_REGION=$AWS_REGION

account=$(aws sts get-caller-identity --query Account --output text) \
  || die "no working AWS credentials. Run aws configure sso (or aws sso login) first."
echo "Account $account, region $AWS_REGION, stack $STACK, model $BEDROCK_MODEL_ID"

# Bedrock model access. UNVERIFIED: the availability API's output on a real account. A profile id (global., apac., ...)
# is checked as a profile, then its underlying model id (the part after the first dot) is checked for access.
if [[ ${SKIP_BEDROCK_CHECK:-} != 1 ]]; then
  model=$BEDROCK_MODEL_ID profile=
  if [[ $model =~ ^(global|us|eu|apac|au|jp)\. ]]; then
    profile=$model model=${model#*.}
    aws bedrock get-inference-profile --inference-profile-identifier "$profile" >/dev/null \
      || die "inference profile $profile was not found in $AWS_REGION. Copy the exact id from the Bedrock console (Cross-region inference)."
  fi
  avail=$(aws bedrock get-foundation-model-availability --model-id "$model" \
    --query '[authorizationStatus, entitlementAvailability, agreementAvailability.status]' --output text 2>/dev/null) || avail=
  if [[ -n $avail ]]; then
    case $avail in
      *NOT_*|*PENDING*|*ERROR*) die "Bedrock model access for $model is not ready ($avail). Enable it in the Bedrock console for $AWS_REGION (Anthropic models may ask for a one-time use case form), then rerun." ;;
    esac
    echo "Bedrock access for $model: $avail"
  elif [[ -z $profile ]]; then
    listed=$(aws bedrock list-foundation-models --by-provider anthropic --query "modelSummaries[?modelId=='$model'].modelId" --output text) \
      || die "cannot call bedrock:ListFoundationModels. Check that Bedrock is enabled for this account and role."
    [[ -n $listed && $listed != None ]] || die "model $model is not offered in $AWS_REGION. Use a cross-region inference profile id or another region."
    echo "Bedrock lists $model in $AWS_REGION. Access could not be confirmed from the CLI; check the Bedrock console."
  else
    echo "Bedrock access for $model could not be confirmed from the CLI; check the Bedrock console. Continuing."
  fi
fi

export PATH="$PWD/backend/node_modules/.bin:$PATH"   # sam build needs esbuild, and npm puts it here
sam build -t infra/template.yaml --config-file "$CONFIG"
mask() { while IFS= read -r line || [[ -n $line ]]; do printf '%s\n' "${line//"$DEMO_KEY"/****}"; done; }
sam deploy --config-file "$CONFIG" --stack-name "$STACK" --region "$AWS_REGION" --no-confirm-changeset \
  --parameter-overrides "DemoKey=$DEMO_KEY BedrockModelId=$BEDROCK_MODEL_ID ReviewOrigin=$REVIEW_ORIGIN" 2>&1 | mask

aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Outputs' --output table
echo "Next: API_URL=<ApiUrl above> DEMO_KEY=<your key> node scripts/smoke.mjs"
