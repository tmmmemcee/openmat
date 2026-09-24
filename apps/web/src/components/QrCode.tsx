import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Button, CopyButton, Dialog, cx } from "../ui";

/** A QR code as crisp SVG (prints sharp at any size). */
export function QrCode({ text, className, dark = "#0f172a", light = "#ffffff", label }: { text: string; className?: string; dark?: string; light?: string; label?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark, light } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(""));
    return () => {
      alive = false;
    };
  }, [text, dark, light]);
  return <div role="img" aria-label={label ?? `QR code for ${text}`} className={cx("aspect-square [&>svg]:h-full [&>svg]:w-full", className)} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** "QR" button that opens a big scannable code for a link. */
export function QrButton({ url, title, note }: { url: string; title: string; note?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label={`Show QR code: ${title}`}>
        QR
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <div className="space-y-3 text-center">
          <QrCode text={url} className="mx-auto w-full max-w-xs" label={`QR code: ${title}`} />
          {note && <p className="text-sm text-slate-600">{note}</p>}
          <p className="font-mono text-xs break-all text-slate-500">{url}</p>
          <div className="flex justify-center">
            <CopyButton text={url} label="Copy link" />
          </div>
        </div>
      </Dialog>
    </>
  );
}
