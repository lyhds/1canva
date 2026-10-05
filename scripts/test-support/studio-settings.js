import path from "node:path";
import { atomic } from "../product-studio/store.js";

/**
 * Temporary stores used by the offline tests need the credential that production
 * keeps in settings.json: job snapshots deliberately never carry one, because the
 * pipeline merges the current key in through Store.config() when a job runs.
 * Endpoint, model and protocol keep coming from the job snapshot.
 */
export function seedModelKeys(store, { endpoint = "https://example.com", model = "test", visionKey = "test", imageKey = "test" } = {}) {
  const current = store.settings();
  atomic(path.join(store.dir, "settings.json"), {
    ...current,
    vision: { ...current.vision, endpoint, model, apiKey: visionKey },
    image: { ...current.image, endpoint, model, apiKey: imageKey },
  });
  return store;
}
