import { useEffect, useState } from "react";

import type { AppClient, AssetReference } from "../../shared/types";
import { toAssetUrl } from "./helpers";

export function useResolvedAssetUrl(
  appClient: AppClient | null | undefined,
  asset: AssetReference | null | undefined
) {
  const [assetUrl, setAssetUrl] = useState<string | null>(() => toAssetUrl(asset));

  useEffect(() => {
    let cancelled = false;

    if (!asset) {
      setAssetUrl(null);
      return () => {
        cancelled = true;
      };
    }

    const fallbackUrl = toAssetUrl(asset);
    setAssetUrl(fallbackUrl);

    if (!appClient) {
      return () => {
        cancelled = true;
      };
    }

    void appClient
      .resolveAssetUrl(asset)
      .then((resolvedUrl) => {
        if (!cancelled) {
          setAssetUrl(resolvedUrl ?? fallbackUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAssetUrl(fallbackUrl);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appClient, asset?.assetId, asset?.kind]);

  return assetUrl;
}
