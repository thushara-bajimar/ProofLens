import { useEffect, useState } from 'react';
import { formatBytes } from '../services/format.js';

/** Shows a thumbnail and basic file facts measured in the browser. */
export function FilePreview({ file, onClear }) {
  const [url, setUrl] = useState(null);
  const [dims, setDims] = useState(null);
  useEffect(() => {
    if (!file) return undefined;
    const u = URL.createObjectURL(file);
    setUrl(u);
    const img = new Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (!file) return null;
  return (
    <div className="preview">
      {url && <img src={url} alt="Selected" />}
      <div>
        <dl className="kv">
          <dt>Name</dt><dd>{file.name}</dd>
          <dt>Size</dt><dd>{formatBytes(file.size)}</dd>
          <dt>Type (as reported)</dt><dd>{file.type || 'unknown'}</dd>
          <dt>Dimensions</dt><dd>{dims ? `${dims.w} × ${dims.h}` : '…'}</dd>
        </dl>
        <p className="muted small" style={{ marginTop: 10 }}>The server checks the real file type from its contents, not from the name.</p>
        {onClear && <button type="button" className="btn btn-secondary btn-sm" onClick={onClear}>Choose another image</button>}
      </div>
    </div>
  );
}
