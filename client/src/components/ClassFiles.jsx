import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Spinner, EmptyState } from './ui';

const CATEGORIES = [
  { key: 'syllabus', label: 'Syllabus' },
  { key: 'notes', label: 'Notes' },
  { key: 'handouts', label: 'Handouts' },
  { key: 'other', label: 'Other' },
];

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Per-class file manager: drag-drop upload with a category, grouped list with
 *  download/preview and delete. Files are stored on the server (base64). */
export function ClassFiles({ classId }) {
  const [files, setFiles] = useState(null);
  const [category, setCategory] = useState('other');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const load = () =>
    api
      .get(`/api/classes/${classId}/files`)
      .then((r) => setFiles(r.data.files))
      .catch((err) => setError(errorMessage(err)));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const uploadFiles = async (fileList) => {
    setError('');
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('category', category);
        await api.post(`/api/classes/${classId}/files`, fd);
      }
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  const download = async (f) => {
    try {
      const res = await api.get(`/api/files/${f.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(errorMessage(err, 'Could not open file'));
    }
  };

  const remove = async (f) => {
    if (!confirm(`Delete "${f.filename}"?`)) return;
    try {
      await api.delete(`/api/files/${f.id}`);
      setFiles((fs) => fs.filter((x) => x.id !== f.id));
    } catch (err) {
      setError(errorMessage(err, 'Could not delete file'));
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload area */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
          dragOver ? 'border-brand-400 bg-brand-50/50' : 'border-purple-soft/50 bg-white/40'
        }`}
      >
        <p className="text-sm font-semibold text-ink">Drag & drop files here</p>
        <p className="mt-0.5 text-xs text-muted">PDF, Office docs, images, or text — up to 16MB</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <label className="text-xs font-semibold text-ink">
            Category:{' '}
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="field !w-auto !py-1 text-sm">
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="btn btn-primary">
            {uploading ? 'Uploading…' : 'Choose files'}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && uploadFiles(e.target.files)}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-300/50 bg-rose-50/70 px-4 py-2.5 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {files === null ? (
        <Spinner label="Loading files…" />
      ) : files.length === 0 ? (
        <EmptyState title="No files yet">Upload a syllabus, notes, or handouts to keep them with this class.</EmptyState>
      ) : (
        <div className="space-y-5">
          {CATEGORIES.map((cat) => {
            const group = files.filter((f) => f.category === cat.key);
            if (group.length === 0) return null;
            return (
              <div key={cat.key}>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">{cat.label}</h3>
                <div className="glass-card divide-y divide-white/40 overflow-hidden">
                  {group.map((f) => (
                    <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-lg">📄</span>
                      <button
                        type="button"
                        onClick={() => download(f)}
                        className="min-w-0 flex-1 text-left"
                        title="Open / download"
                      >
                        <div className="truncate text-sm font-semibold text-ink hover:text-brand-600">{f.filename}</div>
                        <div className="text-xs text-muted">{fmtSize(f.sizeBytes)} · {fmtDate(f.uploadedAt)}</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(f)}
                        className="text-xs font-semibold text-muted transition hover:text-rose-500"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
