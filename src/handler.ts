import {Context} from './context'
import {OutputVars} from './types'
import {
  createPreviewApp,
  deletePreviewApp,
  pollPreviewAppCreationJob
} from './previewApps'
import {getRealtimeLogs} from './tasks'
import {getOutputVars} from './utils'
import { getHasuraEnvVars } from './parameters';
import * as core from '@actions/core'

export const handler = async (context: Context): Promise<OutputVars | {}> => {
  if (context.parameters.SHOULD_DELETE) {
    context.logger.log('Deleting Hasura Cloud preview app.')
    const deleteResp = await deletePreviewApp(context)
    context.logger.log(
      `Preview app "${context.parameters.NAME}" deleted successfully.`
    )
    return deleteResp
  }

  context.logger.log('Creating Hasura Cloud preview app.')
  
  context.logger.log(`Context:\n${JSON.stringify(context, null, 2)}`)

  const createResp = await createPreviewApp(context)
  context.logger.log(
    `Scheduled creation of preview app:\n${JSON.stringify(createResp, null, 2)}`
  )

  context.logger.log(`Polling the preview app creation status...`);

  const previewAppCreationMetadata = await pollPreviewAppCreationJob(
    context,
    createResp.githubPreviewAppJobID
  )
  
  context.logger.log(`Preview app creation metadata:\n${JSON.stringify(previewAppCreationMetadata, null, 2)}`);

  context.logger.log(`Applying metadata and migrations from the branch...`);

  const envVars = getHasuraEnvVars(core.getInput('hasuraEnv'));
  context.logger.log(`Hasura env vars:\n${JSON.stringify(envVars, null, 2)}`);

  const jobStatus = await getRealtimeLogs(
    previewAppCreationMetadata.githubDeploymentJobID,
    context,
  );

  if (jobStatus === 'failed') {
    throw new Error(
      'Preview app has been created, but applying metadata and migrations failed'
    )
  }
  return getOutputVars(previewAppCreationMetadata, context.parameters)
}
