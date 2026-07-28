/**
 * The smallest possible GitHub API client.
 *
 * Only two operations are needed — list a pull request's comments and
 * create or update one — so `fetch` is enough and a vendor SDK would be
 * megabytes of committed bundle for nothing.
 *
 * Every failure is non-fatal. Being unable to post a comment must never fail a
 * lint run: the annotations are already on the diff, and a job that goes red
 * because of a permissions setting teaches people to remove the job.
 */

export interface CommentTarget {
  owner: string;
  repo: string;
  pullNumber: number;
  token: string;
  /** Overridable for GitHub Enterprise. */
  apiUrl?: string;
}

export interface IssueComment {
  id: number;
  body: string;
}

export type CommentOutcome =
  | { status: 'created'; url?: string }
  | { status: 'updated'; url?: string }
  | { status: 'skipped'; reason: string };

const DEFAULT_API = 'https://api.github.com';
const USER_AGENT = 'anchor-lint-action';

function headers(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
  };
}

/** Describes an HTTP failure without ever echoing the request headers. */
async function describeFailure(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') detail = ` ${body.message}`;
  } catch {
    /* A non-JSON error body adds nothing. */
  }

  if (response.status === 403 || response.status === 404) {
    return (
      `${response.status}.${detail} The workflow needs \`permissions: pull-requests: write\`. ` +
      'Note that a run triggered by a fork gets a read-only token, which no permission block can change.'
    );
  }
  return `${response.status}.${detail}`;
}

/** Finds Anchor's previous comment, identified by a marker in the body. */
export async function findExistingComment(
  target: CommentTarget,
  marker: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IssueComment | null> {
  const base = target.apiUrl ?? DEFAULT_API;
  const url = `${base}/repos/${target.owner}/${target.repo}/issues/${target.pullNumber}/comments?per_page=100`;

  const response = await fetchImpl(url, { headers: headers(target.token) });
  if (!response.ok) return null;

  const comments = (await response.json()) as IssueComment[];
  return comments.find((comment) => comment.body.includes(marker)) ?? null;
}

/**
 * Posts the report, replacing Anchor's previous comment when there is one.
 *
 * Updating rather than appending matters: a busy pull request would otherwise
 * accumulate a comment per push until the thread is unreadable.
 */
export async function upsertComment(
  target: CommentTarget,
  body: string,
  marker: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CommentOutcome> {
  const base = target.apiUrl ?? DEFAULT_API;

  try {
    const existing = await findExistingComment(target, marker, fetchImpl);

    const url =
      existing === null
        ? `${base}/repos/${target.owner}/${target.repo}/issues/${target.pullNumber}/comments`
        : `${base}/repos/${target.owner}/${target.repo}/issues/comments/${existing.id}`;

    const response = await fetchImpl(url, {
      method: existing === null ? 'POST' : 'PATCH',
      headers: headers(target.token),
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      return { status: 'skipped', reason: `GitHub returned ${await describeFailure(response)}` };
    }

    const created = (await response.json()) as { html_url?: unknown };
    const htmlUrl = typeof created.html_url === 'string' ? created.html_url : undefined;

    return existing === null
      ? { status: 'created', ...(htmlUrl === undefined ? {} : { url: htmlUrl }) }
      : { status: 'updated', ...(htmlUrl === undefined ? {} : { url: htmlUrl }) };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { status: 'skipped', reason: `the request failed: ${message}` };
  }
}
