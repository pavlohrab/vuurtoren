/**
 * The dictionary on a phone (Settings → Your words and the end of the welcome): the
 * `dictionary-nl` pack kept on the device gives words their meanings without a server. Shows
 * its size, downloads it (once by itself with `autoStart`) and says when it is there. Renders
 * nothing where the device has no such pack (computers use their bundled language server).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Button, Spinner } from "@app/ui";
import { formatBytes } from "../../format.js";
import { currentDevice } from "../../platform/index.js";
import { errorText } from "../../services/errors.js";

export function DictionaryPack({ autoStart = false }: { autoStart?: boolean }) {
  const pack = currentDevice().bridge?.dictionary ?? null;
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["dictionary-pack"],
    queryFn: () => pack!.status(),
    enabled: !!pack,
  });
  const install = useMutation({
    mutationFn: () => pack!.install(),
    onSettled: () => qc.invalidateQueries({ queryKey: ["dictionary-pack"] }),
  });
  const started = useRef(false);
  const missing = status.data && !status.data.installed;
  useEffect(() => {
    if (autoStart && missing && !started.current) {
      started.current = true;
      install.mutate();
    }
  }, [autoStart, missing, install]);

  if (!pack || !status.data) return null;
  const size = formatBytes(status.data.download || status.data.bytes);
  return (
    <section className="stack" aria-labelledby="dict-pack-h" style={{ gap: 8 }}>
      <h3 className="settings-h3" id="dict-pack-h">
        Dictionary on this phone
      </h3>
      {status.data.installed ? (
        <p className="k-hint" style={{ margin: 0 }}>
          Installed ({formatBytes(status.data.bytes)}). Words get their meaning without a server.
        </p>
      ) : install.isPending ? (
        <p role="status" style={{ margin: 0 }}>
          <Spinner label="Downloading" /> Downloading the dictionary ({size})
        </p>
      ) : (
        <>
          <p className="k-hint" style={{ margin: 0 }}>
            Meanings of the words you tap, also offline. A download of {size}.
          </p>
          <div className="row">
            <Button onClick={() => install.mutate()}>Download the dictionary</Button>
          </div>
        </>
      )}
      {install.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          The download did not finish. {errorText(install.error)}
        </p>
      ) : null}
    </section>
  );
}
