import { env } from "../env";
import { HttpBackgroundRemovalProvider } from "./bg-removal";
import { MockBackgroundRemovalProvider, MockImageEditProvider } from "./mock";
import { OpenAIImageEditProvider } from "./openai";
import { ProviderError, type BackgroundRemovalProvider, type ImageEditProvider } from "./types";

export * from "./types";

let editProvider: ImageEditProvider | null = null;
let bgProvider: BackgroundRemovalProvider | null | undefined;

/** The main AI image-edit provider selected by IMAGE_PROVIDER. */
export function getImageEditProvider(): ImageEditProvider {
  if (editProvider) return editProvider;
  switch (env.imageProvider) {
    case "mock":
      editProvider = new MockImageEditProvider();
      break;
    case "openai":
      editProvider = new OpenAIImageEditProvider();
      break;
    default:
      throw new ProviderError("not_configured", `Unknown IMAGE_PROVIDER "${env.imageProvider}"`);
  }
  return editProvider;
}

/** Optional dedicated background-removal provider; null when not configured. */
export function getBackgroundRemovalProvider(): BackgroundRemovalProvider | null {
  if (bgProvider !== undefined) return bgProvider;
  const name = env.bgRemovalProvider;
  if (name === "mock") bgProvider = new MockBackgroundRemovalProvider();
  else if ((name === "photoroom" || name === "removebg") && env.bgRemovalApiKey)
    bgProvider = new HttpBackgroundRemovalProvider(name, env.bgRemovalApiKey);
  else bgProvider = null;
  return bgProvider;
}

/** For tests. */
export function setProviders(edit: ImageEditProvider | null, bg?: BackgroundRemovalProvider | null) {
  editProvider = edit;
  bgProvider = bg;
}
