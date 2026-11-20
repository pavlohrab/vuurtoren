import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Slider, TextCover, coverKind, useToast } from "@app/ui";
import { ImagePlus } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { useServices } from "../../services/context.js";
import type { TextListItem } from "../../services/types.js";
import { cropFor, loadImage, renderCover } from "./coverImage.js";
import { useCoverUrl } from "./useCoverUrl.js";
import { errorText } from "../../services/errors.js";

/** Width of the crop frame on screen (4:5). */
const FRAME_W = 200;
const FRAME_H = 250;

/**
 * Change a text's cover: pick a photo, place it in the 4:5 frame (drag or arrow keys, zoom),
 * saved as a 600px WebP; or go back to the typographic cover. `text` null = closed.
 */
export function CoverDialog({ text, onClose }: { text: TextListItem | null; onClose: () => void }) {
  return (
    <Dialog
      open={text !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Cover"
      description="Use a photo of the book or page, or keep the plain cover."
    >
      {text ? <CoverForm key={text.id} text={text} onClose={onClose} /> : null}
    </Dialog>
  );
}

function CoverForm({ text, onClose }: { text: TextListItem; onClose: () => void }) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const current = useCoverUrl(text.coverId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0.5, y: 0.5 });
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);

  useEffect(() => () => (img ? URL.revokeObjectURL(img.src) : undefined), [img]);

  const save = useMutation({
    mutationFn: async (image: Blob | null) => services.setTextCover(text.id, image),
    onSuccess: async () => {
      onClose();
      await qc.invalidateQueries({ queryKey: ["texts"] });
    },
    onError: (e) => toast("Could not save the cover", errorText(e)),
  });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const loaded = await loadImage(file);
      setImg(loaded);
      setZoom(1);
      setPan({ x: 0.5, y: 0.5 });
    } catch (e) {
      toast("Could not open the photo", errorText(e));
    }
  };

  const crop = img ? cropFor(img.naturalWidth, img.naturalHeight, zoom, pan.x, pan.y) : null;
  const scale = crop ? FRAME_W / crop.w : 1;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  /** Move the frame by screen pixels (drag) — converted to pan fractions. */
  const moveBy = (dx: number, dy: number, from = pan) => {
    if (!img || !crop) return;
    const freeX = img.naturalWidth - crop.w;
    const freeY = img.naturalHeight - crop.h;
    setPan({
      x: freeX > 0 ? clamp(from.x - dx / scale / freeX) : 0.5,
      y: freeY > 0 ? clamp(from.y - dy / scale / freeY) : 0.5,
    });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, pan };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) moveBy(e.clientX - d.x, e.clientY - d.y, d.pan);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.2 : 0.05;
    const keys: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const k = keys[e.key];
    if (!k) return;
    e.preventDefault();
    setPan((p) => ({ x: clamp(p.x + k[0]), y: clamp(p.y + k[1]) }));
  };

  return (
    <div className="lib-cover-dialog">
      <div className="lib-cover-stage">
        {img && crop ? (
          <div
            className="lib-crop"
            style={{ width: FRAME_W, height: FRAME_H }}
            tabIndex={0}
            role="group"
            aria-label="Photo position: drag, or use the arrow keys"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={onKey}
          >
            <img
              src={img.src}
              alt=""
              draggable={false}
              style={{
                width: img.naturalWidth * scale,
                height: img.naturalHeight * scale,
                transform: `translate(${-crop.x * scale}px, ${-crop.y * scale}px)`,
              }}
            />
          </div>
        ) : (
          <div className="lib-cover-preview">
            <TextCover
              title={text.title}
              kind={coverKind(text.sourceKind, text.sourceRef)}
              imageUrl={current}
            />
          </div>
        )}
      </div>
      {img ? (
        <div className="lib-zoom">
          <span className="k-label">Zoom</span>
          <Slider
            value={zoom}
            min={1}
            max={3}
            step={0.05}
            onValueChange={setZoom}
            aria-label="Zoom"
          />
        </div>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        aria-label="Choose a photo"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <div className="k-dialog-actions">
        {!img && text.coverId ? (
          <Button
            variant="ghost"
            className="lib-form-reset"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            Use plain cover
          </Button>
        ) : null}
        <Button variant={img ? "ghost" : "secondary"} onClick={() => fileInput.current?.click()}>
          <ImagePlus size={16} aria-hidden /> {img ? "Another photo" : "Choose a photo"}
        </Button>
        {img && crop ? (
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() =>
              void renderCover(img, crop).then(
                (b) => save.mutate(b),
                (e: unknown) => toast("Could not make the cover", errorText(e)),
              )
            }
          >
            Save cover
          </Button>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </div>
  );
}
