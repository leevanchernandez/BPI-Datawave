#!/usr/bin/env bash
# Delete the demo stack after recording: empty the upload bucket, delete the stack, then delete its Lambda log groups.
# Required env: AWS_REGION, and CONFIRM_TEARDOWN=counter-check-demo (the stack name, typed on purpose).
set -euo pipefail
STACK=counter-check-demo
export SAM_CLI_TELEMETRY=0

die() { echo "teardown: $*" >&2; exit 1; }
[[ -n ${AWS_REGION:-} ]] || die "set AWS_REGION"
[[ ${CONFIRM_TEARDOWN:-} == "$STACK" ]] || die "set CONFIRM_TEARDOWN=$STACK to delete the stack and every upload in it"
for c in aws sam; do command -v "$c" >/dev/null || die "$c is not installed"; done
export AWS_DEFAULT_REGION=$AWS_REGION

account=$(aws sts get-caller-identity --query Account --output text) || die "no working AWS credentials"
echo "Deleting $STACK in account $account, region $AWS_REGION"
bucket=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='UploadBucketName'].OutputValue" --output text) || die "stack $STACK not found in $AWS_REGION"
if [[ -n $bucket && $bucket != None ]]; then aws s3 rm "s3://$bucket" --recursive --quiet; fi   # the bucket is not versioned
sam delete --stack-name "$STACK" --region "$AWS_REGION" --no-prompts

for g in $(aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/$STACK-" --query 'logGroups[].logGroupName' --output text); do
  aws logs delete-log-group --log-group-name "$g" || echo "could not delete log group $g"
done
echo "Done. The SAM artifact stack aws-sam-cli-managed-default (from resolve_s3) is kept; delete it in CloudFormation if nothing else uses it."
