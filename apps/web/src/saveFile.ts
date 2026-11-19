/** Save bytes or text as a file through a temporary link (the browser's download). */
export function saveFile(data: Uint8Array | string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
