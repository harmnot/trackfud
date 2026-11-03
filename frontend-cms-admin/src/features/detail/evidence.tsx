import { useEffect, useState } from 'react';
import { fetchFileBlob } from '../../lib/api';
import { MISSING } from '../../lib/format';
import { logger } from '../../lib/logger';
import type { CourierApplication } from '../../lib/types';

/** Load one private file's bytes into an object URL (revoked on unmount). */
export function useFileObjectUrl(fileId: string | undefined): {
  url: string | null;
  failed: boolean;
  loading: boolean;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fileId) {
      setUrl(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    let live = true;
    let objectUrl: string | null = null;
    setLoading(true);
    setFailed(false);
    fetchFileBlob(fileId)
      .then((blob) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setLoading(false);
      })
      .catch(() => {
        logger.warn('evidence image failed', {});
        if (live) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  return { url, failed, loading };
}

/** One review-evidence photo: ID, selfie, bike or checkpoint shot. */
export function FileImage({ fileId, label }: { fileId: string; label: string }) {
  const { url, failed, loading } = useFileObjectUrl(fileId);
  return (
    <figure className="tb-shot">
      {loading && <div className="tb-skel" style={{ height: '11rem' }} aria-label="Loading photo…" />}
      {!loading && !failed && url && <img src={url} alt={label} loading="lazy" />}
      {!loading && (failed || !url) && <p className="tb-sub tb-shot-missing">{MISSING} (could not load)</p>}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** Evidence photos the courier submitted: IDs, selfie, bike and qual checkpoints. */
export function EvidenceCard({
  profile,
  fitness,
}: {
  profile: { id_front_file_id?: string; id_back_file_id?: string; selfie_file_id?: string; bike?: Record<string, unknown> } | null;
  fitness: CourierApplication['fitness'];
}) {
  const bikePhoto = typeof profile?.bike?.['photo_file_id'] === 'string' ? (profile.bike['photo_file_id'] as string) : '';
  const shots: Array<{ fileId: string; label: string }> = [];
  if (profile?.id_front_file_id) shots.push({ fileId: profile.id_front_file_id, label: 'ID front' });
  if (profile?.id_back_file_id) shots.push({ fileId: profile.id_back_file_id, label: 'ID back' });
  if (profile?.selfie_file_id) shots.push({ fileId: profile.selfie_file_id, label: 'Selfie' });
  if (bikePhoto !== '') shots.push({ fileId: bikePhoto, label: 'Bike photo' });
  for (const [i, id] of (fitness.checkpoint_file_ids ?? []).entries()) {
    shots.push({ fileId: id, label: `Checkpoint ${i + 1}` });
  }
  return (
    <div className="tb-card">
      <h2 className="tb-h2">Evidence photos ({shots.length})</h2>
      {shots.length === 0 ? (
        <p className="tb-sub mt-3">No photos submitted yet.</p>
      ) : (
        <div className="tb-shots">
          {shots.map((s) => (
            <FileImage key={`${s.label}-${s.fileId}`} fileId={s.fileId} label={s.label} />
          ))}
        </div>
      )}
    </div>
  );
}
