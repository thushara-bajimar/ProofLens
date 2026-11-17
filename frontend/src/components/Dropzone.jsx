import { useRef, useState } from 'react';
import { Icon } from './Icons.jsx';

/**
 * Drag-and-drop / click-to-choose image picker. Only does client-side
 * convenience checks; the server re-validates everything from the file bytes.
 */
export function Dropzone({ onFile, accept = 'image/jpeg,image/png,image/webp', label = 'Drop an image here, or click to choose', hint = 'JPEG, PNG or WebP, up to 15 MB' }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const pick = (files) => { if (files && files[0]) onFile(files[0]); };
  return (
    <div
      className={`dropzone ${dragging ? 'dragging' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files); }}
    >
      <div className="dz-icon"><Icon name="upload" size={30} /></div>
      <div className="dz-title">{label}</div>
      <div className="muted small">{hint}</div>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
    </div>
  );
}
