# AWS runbook

What to do on the day AWS access arrives. Background and open questions are in docs/aws.md. Steps 1, 2, 4, 5 and 6 were run on the hackathon account on 2026-11-12, with `scripts/deploy-cli.sh` in place of `scripts/deploy.sh`. The opt-out check and the teardown were not.

## Before any upload: Textract AI-services opt-out

Unless the organization opts out, AWS may store and use content processed by Textract to improve its AI services. Opting out is an AWS Organizations policy, so it is set from the organization's management account. In BPI's account that is BPI's cloud admin, not the team. Ask them to confirm the policy is in place before the first upload, even though the uploads are synthetic. The hackathon participant role gets AccessDenied on `describe-effective-policy`, so the team cannot check it from its side.

If the team does own the management account, these are the commands. Do not run them from a member account; they fail there.

```sh
aws organizations list-roots --query 'Roots[0].Id' --output text           # prints the root id, r-xxxx
aws organizations enable-policy-type --root-id r-xxxx --policy-type AISERVICES_OPT_OUT_POLICY
aws organizations create-policy --name ai-services-opt-out --type AISERVICES_OPT_OUT_POLICY \
  --description "Opt out of AI service data use for all AI services" \
  --content '{"services":{"default":{"opt_out_policy":{"@@assign":"optOut"}}}}'
aws organizations attach-policy --policy-id p-xxxx --target-id <account-id>  # p-xxxx comes from create-policy
aws organizations describe-effective-policy --policy-type AISERVICES_OPT_OUT_POLICY --target-id <account-id>
```

`default` covers every AI service, Textract included. To opt out Textract alone, use `"textract"` in place of `"default"`. Bedrock is not covered by this policy. Keep Bedrock model invocation logging off (it is off unless someone turns it on).

## Access day, step by step

1. Tools. Install the AWS CLI v2 and the SAM CLI (`uv tool install aws-sam-cli`, `pipx install aws-sam-cli`, or the installer from the AWS docs), and have Node 22. Check with `aws --version`, `sam --version`, `node --version`.
2. Credentials. If BPI gives IAM Identity Center access, run `aws configure sso` once, name the profile `bpi-demo`, then `aws sso login --profile bpi-demo`. If BPI gives access keys instead, run `aws configure --profile bpi-demo`. Then `export AWS_PROFILE=bpi-demo` and check with `aws sts get-caller-identity`.
3. Opt-out. Confirm the Textract opt-out above is in place.
4. Bedrock model access. In the Bedrock console, switch to Asia Pacific (Singapore), open the model access or model catalog page, and enable the chosen Claude model. Anthropic models can ask for a one-time use case form, and the first call may create an AWS Marketplace subscription. Copy the exact model or profile id from the console. On the hackathon account on 2026-11-12, `global.anthropic.claude-haiku-5-5` answered from Singapore on the InvokeModel path with no console step. The Mantle endpoint returned 404 for Haiku 5.5 and 403 for Sonnet 5, so the backend does not use it. Use the global profile id unless the console shows something else.
5. Deploy.
   ```sh
   export AWS_REGION=ap-southeast-1
   export BEDROCK_MODEL_ID='<id copied from the Bedrock console>'
   export REVIEW_ORIGIN='https://<frontend origin, no trailing slash>'
   export DEMO_KEY="$(openssl rand -hex 24)"     # keep it in a password manager, never in git
   npm --prefix backend ci && npm test && npm run test:aws
   scripts/deploy.sh
   ```
   The script checks the credentials, the region and Bedrock model access, then runs `sam build` and `sam deploy` and prints the stack outputs.
   If the role cannot use CloudFormation (the hackathon participant role cannot), run `scripts/deploy-cli.sh` with the same four variables instead. It creates the same resources with plain CLI calls, prints the same two outputs, and can be rerun after a code change.
6. Smoke test. `API_URL='<ApiUrl output>' node scripts/smoke.mjs` (DEMO_KEY is still exported). It checks that a wrong key gets 401, uploads the Elena specimens, runs `/check` for both visits, prints the defects and the drafted message, and asks one question. Each run calls Textract and Bedrock for real.
7. Point the demo at it. Set `AWS_API_URL` in wrangler.jsonc to the ApiUrl output and run `npx wrangler deploy`. The Worker uses its own `DEMO_KEY` for the AWS API, so both must hold the same key. Open the live page with `?stack=aws` (for example `/live?id=RF-2026-042&stack=aws`). The page then uploads the photos to S3 and the check runs on Textract and Bedrock. Without `?stack=aws` the page stays on the free stack. The health route reports `aws: true` when the URL is set.
8. Teardown after recording. `CONFIRM_TEARDOWN=counter-check-demo scripts/teardown.sh` empties the upload bucket, deletes the stack (functions, API, bucket, table) and the Lambda log groups. The `aws-sam-cli-managed-default` artifact stack is kept; delete it in CloudFormation if nothing else uses it. For resources made by `scripts/deploy-cli.sh`, run `CONFIRM_TEARDOWN=counter-check-demo scripts/deploy-cli.sh teardown` instead. That mode has not been run yet.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| deploy.sh stops at the Bedrock check, or Lambda logs show `AccessDeniedException` from Bedrock | Model access not enabled in this region, use case form pending, or no Marketplace subscription | Enable access in the Bedrock console for the region you deploy to, wait for it to show as granted, rerun |
| `AccessDenied` that names a Bedrock ARN after access is granted | The template's Bedrock resource ARNs do not match what the endpoint checks | In infra/template.yaml use the commented `Resource: '*'` line, redeploy, read the denied ARN in CloudTrail, then narrow again |
| Bedrock says the model id is invalid or on-demand use is not supported | The model is only offered through an inference profile in this region | Use the profile id from the console as BEDROCK_MODEL_ID |
| `/check` succeeds but ID, registration and permit pages all land in review | The model call failed and the page went to a person (fail closed) | Look for `modelError` in the `pages` field of the response and in the Lambda logs |
| Region mismatch: stack or model not found | AWS_REGION, the profile's default region and the console region differ | Export AWS_REGION; the scripts set it for every aws and sam command. Check the console region selector |
| `/check` returns 503 after about 30 seconds | HTTP API integrations stop at 30 seconds; the Lambda may still be running | Set `AWS_CHECK_URL` in wrangler.jsonc to the CheckUrl that `deploy-cli.sh` prints, then `npx wrangler deploy`. Without it the Worker retries once |
| Browser shows a CORS error | REVIEW_ORIGIN does not match the page origin exactly (scheme, host, port, no trailing slash) | Redeploy with the right REVIEW_ORIGIN; the API and the bucket both use it |
| `401 demo key required` | Missing or wrong `x-demo-key` header | Send the key used at deploy time |
| S3 upload returns 403 | The presigned POST expired (5 minutes), the file is over 5 MB, or the file is not jpeg, png or pdf | Ask `/upload-url` again and upload right away |
| `sam build` fails with "Cannot find esbuild" | Backend dependencies are missing, or esbuild is not on PATH | `npm --prefix backend ci`, then rerun. scripts/deploy.sh adds `backend/node_modules/.bin` to PATH |
| `sam deploy` fails with AccessDenied on `cloudformation:CreateChangeSet` | The role has no CloudFormation rights | Use `scripts/deploy-cli.sh` |
| `/check` returns 500 and the log shows `ProvisionedThroughputExceededException` | Textract's per-account rate limit for synchronous calls | The adapter already retries with adaptive backoff. If it still fails, lower CONCURRENCY in backend/pipeline.cjs |

## Services to request beyond the six

The six requested services are Bedrock, Textract, Lambda, API Gateway, S3 and DynamoDB. A SAM deploy also needs these.

- CloudFormation. SAM deploys through a stack and change sets, plus a small `aws-sam-cli-managed-default` stack for the artifact bucket. The hackathon participant role does not have it, which is why `scripts/deploy-cli.sh` exists.
- IAM role creation. SAM creates one execution role per function (`CAPABILITY_IAM`), so the deploying role needs to create, tag, update and pass roles.
- CloudWatch Logs. Lambda writes its logs there; it is the only way to debug a failed call. Teardown deletes the log groups.
- KMS with the default AWS managed keys. The upload bucket (SSE-KMS) and the table use the `aws/s3` and `aws/dynamodb` keys. No customer managed key is needed for the demo.
- Bedrock control plane reads (`ListFoundationModels`, `GetFoundationModelAvailability`, `GetInferenceProfile`) for the deploy check, and AWS Marketplace subscribe rights or an admin who subscribes, because Anthropic models are billed through Marketplace.
- SSM Parameter Store is not used. The demo key is a NoEcho template parameter stored as a Lambda environment variable. It is needed only if the key moves out of the Lambda configuration.
- An AWS Organizations admin, only to set the Textract opt-out above.
