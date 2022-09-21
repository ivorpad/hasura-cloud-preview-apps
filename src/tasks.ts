import {Context} from './context'
import {JobDetails} from './types'
import {waitFor} from './utils'
import {Retrier} from '@jsier/retrier'

const options = {limit: 5, delay: 2000}
const retrier = new Retrier(options)

const getTaskName = (taskName?: string) => {
  switch (taskName) {
    case 'gh-validation':
      return 'Fetching Metadata'
    case 'parse-metadata-migration':
      return 'Parsing metadata and migrations'
    case 'apply-metadata':
      return 'Applying metadata'
    case 'apply-migration':
      return 'Applying migrations'
    case 'reload-metadata':
      return 'Refreshing metadata'
    case 'check-healthz':
      return 'Checking Project Health'
    default:
      return null
  }
}

const getTaskStatus = (status: string) => {
  if (status === 'created') {
    return 'started'
  }
  return status
}

export const getProjectByPk = async (projectId: string, context: Context) => {
  try {
    const resp = await context.client.query<
      {
        projects_by_pk: {endpoint: string, id: string; tenant: {id: string}}
      },
      {projectId: string}
    >({
      query: `
        query getProjectByPk($projectId: uuid!) {
          projects_by_pk(id: $projectId) {
            tenant {
              id
            }
            endpoint
            id
          }
        }
      `,
      variables: {
        projectId
      }
    });

    context.logger.log(`Project By PK: ${JSON.stringify(resp, null, 2)}`)

    return resp.projects_by_pk
  } catch (e) {
    if (e instanceof Error) {
      context.logger.log(e.message)
    }
    throw e
  }
}

export const getTenantEnvByTenantId = async (
  tenantId: string,
  context: Context
) => {
  try {
    const resp = await context.client.query<{
      getTenantEnv: {
        hash: string
        envVars: Record<any, any>
      }
    }, { tenantId: string }>({
      query: `
        query getTenantEnv($tenandId: uuid!) {
          getTenantEnv(tenantId: $tenandId) {
            hash
            envVars
          }
        }
      `,
      variables: {
        tenantId
      }
    })
    return resp.getTenantEnv
  } catch (e) {
    if (e instanceof Error) {
      context.logger.log(e.message)
    }
    throw e
  }
}


const getJobStatus = async (jobId: string, context: Context) => {
  try {
    const resp = await context.client.query<JobDetails, {jobId: string}>({
      query: `
        query getJobStatus($jobId: uuid!) {
          jobs_by_pk(id: $jobId) {
            status
            tasks(order_by: { updated_at: asc }) {
              id
              name
              cloud
              region task_events(order_by: { updated_at: desc }, limit: 1) {
                event_type
                id
                error
                github_detail
              }
            }
          }
        }
      `,
      variables: {
        jobId
      }
    })

    // context.logger.log(`Job Status: ${JSON.stringify(resp, null, 2)}`)

    if (!resp.jobs_by_pk) {
      throw new Error(
        'could not find the GitHub job; the associated deployment was terminated'
      )
    }
    const tasksCount = resp.jobs_by_pk?.tasks.length
    if (tasksCount && tasksCount > 0) {
      const latestTask = resp.jobs_by_pk?.tasks[tasksCount - 1]
      const taskEventsCount = latestTask?.task_events.length
      if (latestTask && taskEventsCount && taskEventsCount > 0) {
        const latestTaskEvent = latestTask.task_events[taskEventsCount - 1]
        context.logger.log(
          `${getTaskName(latestTask.name)}: ${getTaskStatus(
            latestTaskEvent?.event_type
          )}`,
          false
        )
        if (latestTaskEvent?.github_detail) {
          context.logger.log(latestTaskEvent?.github_detail, false)
        }
        if (
          latestTaskEvent &&
          latestTaskEvent.event_type === 'failed' &&
          latestTaskEvent.error
        ) {
          context.logger.log(latestTaskEvent?.error, false)
        }
      }
    }
    return resp.jobs_by_pk.status
  } catch (e) {
    if (e instanceof Error) {
      context.logger.log(e.message)
    }
    throw e
  }
}

export const getRealtimeLogs = async (
  jobId: string,
  context: Context,
  retryCount = 0
) => {
  if (retryCount > 0) {
    await waitFor(2000)
  }
  const jobStatus = await getJobStatus(jobId, context)
  if (jobStatus === 'success') {
    return 'success'
  }
  if (jobStatus === 'failed') {
    return 'failed'
  }
  return getRealtimeLogs(jobId, context, retryCount + 1)
}
