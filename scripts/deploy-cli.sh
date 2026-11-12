#!/usr/bin/env bash
# Creates the same resources as infra/template.yaml with plain AWS CLI calls, for roles that cannot use CloudFormation.
# The hackathon participant role is one of them (cloudformation:CreateChangeSet was denied on 2026-11-12).
# Safe to rerun. It never prints the demo key.
#   Deploy:   AWS_REGION=... DEMO_KEY=... BEDROCK_MODEL_ID=... REVIEW_ORIGIN=... scripts/deploy-cli.sh
#   Teardown: AWS_REGION=... CONFIRM_TEARDOWN=counter-check-demo scripts/deploy-cli.sh teardown
set -euo pipefail
cd "$(dirname "$0")/.."

N=counter-check-demo
: "${AWS_REGION:?set AWS_REGION}"
export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION" AWS_PAGER=""
ACCT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="$N-uploads-$ACCT"
TABLE="$N-events"
LOGS=arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
FNS=(check ask upload-url)   # function suffix, which is also the route path
api_id() { aws apigatewayv2 get-apis --query "Items[?Name=='$N'].ApiId | [0]" --output text; }

if [[ "${1:-}" == teardown ]]; then
  [[ "${CONFIRM_TEARDOWN:-}" == "$N" ]] || { echo "set CONFIRM_TEARDOWN=$N to delete the demo resources" >&2; exit 1; }
  API=$(api_id); [[ "$API" == None ]] || aws apigatewayv2 delete-api --api-id "$API"
  for f in "${FNS[@]}"; do
    aws lambda delete-function --function-name "$N-$f" || true
    aws logs delete-log-group --log-group-name "/aws/lambda/$N-$f" || true
    aws iam delete-role-policy --role-name "$N-$f" --policy-name inline || true
    aws iam detach-role-policy --role-name "$N-$f" --policy-arn "$LOGS" || true
    aws iam delete-role --role-name "$N-$f" || true
  done
  aws s3 rb "s3://$BUCKET" --force || true
  aws dynamodb delete-table --table-name "$TABLE" >/dev/null || true
  echo "teardown done"; exit 0
fi

: "${DEMO_KEY:?set DEMO_KEY}" "${BEDROCK_MODEL_ID:?set BEDROCK_MODEL_ID}" "${REVIEW_ORIGIN:?set REVIEW_ORIGIN}"
[[ "$DEMO_KEY" =~ ^[A-Za-z0-9_-]{24,}$ ]] || { echo "DEMO_KEY needs 24 or more characters from A-Z a-z 0-9 _ -" >&2; exit 1; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# Same bundle settings as the template's esbuild metadata. One bundle serves all three handlers.
backend/node_modules/.bin/esbuild backend/lambda.cjs --bundle --minify --platform=node --target=es2022 --format=cjs \
  '--external:@aws-sdk/client-*' --external:@aws-sdk/lib-dynamodb --outfile="$tmp/lambda.js" --log-level=warning
(cd "$tmp" && zip -q fn.zip lambda.js)
printf '{"Variables":{"EVENTS_TABLE":"%s","UPLOAD_BUCKET":"%s","BEDROCK_MODEL_ID":"%s","DEMO_KEY":"%s"}}' \
  "$TABLE" "$BUCKET" "$BEDROCK_MODEL_ID" "$DEMO_KEY" > "$tmp/env.json"

echo "bucket $BUCKET"
# ponytail: LocationConstraint is rejected in us-east-1. Drop the flag there if the demo ever moves.
aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null || aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[{"ID":"expire-uploads","Status":"Enabled","Filter":{},"Expiration":{"Days":1}}]}' >/dev/null
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "{\"CORSRules\":[{\"AllowedMethods\":[\"POST\"],\"AllowedOrigins\":[\"$REVIEW_ORIGIN\"],\"AllowedHeaders\":[\"*\"],\"MaxAgeSeconds\":300}]}"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"TlsOnly\",\"Effect\":\"Deny\",\"Principal\":\"*\",\"Action\":\"s3:*\",\"Resource\":[\"arn:aws:s3:::$BUCKET\",\"arn:aws:s3:::$BUCKET/*\"],\"Condition\":{\"Bool\":{\"aws:SecureTransport\":\"false\"}}}]}"

echo "table $TABLE"
aws dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1 || {
  aws dynamodb create-table --table-name "$TABLE" --billing-mode PAY_PER_REQUEST --sse-specification Enabled=true \
    --attribute-definitions AttributeName=referralId,AttributeType=S AttributeName=at,AttributeType=S \
    --key-schema AttributeName=referralId,KeyType=HASH AttributeName=at,KeyType=RANGE >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE"
  aws dynamodb update-time-to-live --table-name "$TABLE" --time-to-live-specification Enabled=true,AttributeName=ttl >/dev/null
}

# One execution role per function, with the same statements as the template.
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
TABLE_ARN="arn:aws:dynamodb:$AWS_REGION:$ACCT:table/$TABLE"
UPLOADS="arn:aws:s3:::$BUCKET/uploads/*"
BEDROCK="{\"Effect\":\"Allow\",\"Action\":[\"bedrock:InvokeModel\",\"bedrock:InvokeModelWithResponseStream\"],\"Resource\":[\"arn:aws:bedrock:*::foundation-model/$BEDROCK_MODEL_ID\",\"arn:aws:bedrock:*:$ACCT:inference-profile/$BEDROCK_MODEL_ID\",\"arn:aws:bedrock:*::foundation-model/anthropic.claude-*\"]}"
role() {   # suffix, statements
  aws iam get-role --role-name "$N-$1" >/dev/null 2>&1 || aws iam create-role --role-name "$N-$1" --assume-role-policy-document "$TRUST" >/dev/null
  aws iam attach-role-policy --role-name "$N-$1" --policy-arn "$LOGS"
  aws iam put-role-policy --role-name "$N-$1" --policy-name inline --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[$2]}"
}
echo "roles"
role check "{\"Effect\":\"Allow\",\"Action\":\"s3:GetObject\",\"Resource\":\"$UPLOADS\"},{\"Effect\":\"Allow\",\"Action\":[\"dynamodb:Query\",\"dynamodb:PutItem\"],\"Resource\":\"$TABLE_ARN\"},{\"Effect\":\"Allow\",\"Action\":[\"textract:DetectDocumentText\",\"textract:AnalyzeDocument\"],\"Resource\":\"*\"},$BEDROCK"
role ask "{\"Effect\":\"Allow\",\"Action\":\"dynamodb:Query\",\"Resource\":\"$TABLE_ARN\"},$BEDROCK"   # the ask handler only queries
role upload-url "{\"Effect\":\"Allow\",\"Action\":\"s3:PutObject\",\"Resource\":\"$UPLOADS\"}"

fn() {   # suffix, handler export, timeout seconds
  local name="$N-$1"
  if aws lambda get-function --function-name "$name" >/dev/null 2>&1; then
    aws lambda update-function-code --function-name "$name" --zip-file "fileb://$tmp/fn.zip" --query FunctionName --output text
    aws lambda wait function-updated-v2 --function-name "$name"
    aws lambda update-function-configuration --function-name "$name" --handler "lambda.$2" --timeout "$3" --environment "file://$tmp/env.json" --query FunctionName --output text >/dev/null
    aws lambda wait function-updated-v2 --function-name "$name"
  else
    for _ in 1 2 3 4 5 6; do   # Lambda cannot assume a brand-new role for the first few seconds
      aws lambda create-function --function-name "$name" --runtime nodejs22.x --handler "lambda.$2" --memory-size 512 --timeout "$3" \
        --role "arn:aws:iam::$ACCT:role/$name" --zip-file "fileb://$tmp/fn.zip" --environment "file://$tmp/env.json" --query FunctionName --output text && break
      sleep 5
    done
    aws lambda wait function-active-v2 --function-name "$name"
  fi
}
echo "functions"
fn check check 60
fn ask ask 60
fn upload-url uploadUrl 10

CORS="{\"AllowOrigins\":[\"$REVIEW_ORIGIN\"],\"AllowMethods\":[\"POST\",\"OPTIONS\"],\"AllowHeaders\":[\"content-type\",\"x-demo-key\"]}"
API=$(api_id)
if [[ "$API" == None ]]; then
  # ponytail: routes are created only with a new API. If this block fails halfway, delete the API and rerun.
  API=$(aws apigatewayv2 create-api --name "$N" --protocol-type HTTP --cors-configuration "$CORS" --query ApiId --output text)
  for f in "${FNS[@]}"; do
    int=$(aws apigatewayv2 create-integration --api-id "$API" --integration-type AWS_PROXY --payload-format-version 2.0 \
      --integration-uri "arn:aws:lambda:$AWS_REGION:$ACCT:function:$N-$f" --query IntegrationId --output text)
    aws apigatewayv2 create-route --api-id "$API" --route-key "POST /$f" --target "integrations/$int" >/dev/null
    aws lambda remove-permission --function-name "$N-$f" --statement-id apigw 2>/dev/null || true
    aws lambda add-permission --function-name "$N-$f" --statement-id apigw --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
      --source-arn "arn:aws:execute-api:$AWS_REGION:$ACCT:$API/*/*/$f" >/dev/null
  done
  aws apigatewayv2 create-stage --api-id "$API" --stage-name '$default' --auto-deploy >/dev/null
else
  aws apigatewayv2 update-api --api-id "$API" --cors-configuration "$CORS" >/dev/null
fi

# The check also gets its own URL, because the HTTP API stops every call at 30 seconds. The handler checks the demo key.
aws lambda get-function-url-config --function-name "$N-check" >/dev/null 2>&1 || {
  aws lambda create-function-url-config --function-name "$N-check" --auth-type NONE >/dev/null
  aws lambda add-permission --function-name "$N-check" --statement-id url --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null
  aws lambda add-permission --function-name "$N-check" --statement-id url-invoke --action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null
}

echo "ApiUrl=https://$API.execute-api.$AWS_REGION.amazonaws.com"
echo "CheckUrl=$(aws lambda get-function-url-config --function-name "$N-check" --query FunctionUrl --output text)"
echo "UploadBucketName=$BUCKET"
