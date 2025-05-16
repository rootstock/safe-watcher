import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

let aws: boolean | undefined;

export async function isAWS(): Promise<boolean> {
  if (aws !== undefined) return aws;
  try {
    await new STSClient({}).send(new GetCallerIdentityCommand({}));
    aws = true;
  } catch (e) {
    aws = false;
  }
  return aws;
}
