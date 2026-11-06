# AWS runbook

What to do on the day AWS access arrives. Background and open questions are in docs/aws.md. Nothing here has been run against a real account yet.

## Before any upload: Textract AI-services opt-out

Unless the organization opts out, AWS may store and use content processed by Textract to improve its AI services. Opting out is an AWS Organizations policy, so it is set from the organization's management account. In BPI's account that is BPI's cloud admin, not the team. Ask them to confirm the policy is in place before the first upload, even though the uploads are synthetic.

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
