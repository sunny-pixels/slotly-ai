import os from "node:os";
import path from "node:path";

/**
 * Where local AI models (embeddings, reranker) are downloaded and cached.
 * - MODEL_CACHE_DIR, if set;
 * - on serverless hosts (Vercel, AWS Lambda) the deployment folder is read-only,
 *   so use the writable temp directory;
 * - otherwise `.cache/models` in the project (git-ignored).
 */
export function modelCacheDir(): string {
  if (process.env.MODEL_CACHE_DIR) return process.env.MODEL_CACHE_DIR;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return path.join(os.tmpdir(), "slotly-models");
  return path.join(process.cwd(), ".cache", "models");
}
