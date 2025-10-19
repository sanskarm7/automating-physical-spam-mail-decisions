
'use client';

import { useEffect, useState } from "react";

type Item = {
  id: number;
  deliveryDate: string | null;
  rawSenderText: string | null;
  imgHash: string | null;
};

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  async function ingest() {
    setLoading(true);
    await fetch('/api/ingest');
    setLoading(false);
    await loadQueue();
  }

  async function loadQueue() {
    const res = await fetch('/api/queue');
    const data = await res.json();
    setItems(data.items || []);
  }

  useEffect(() => { loadQueue(); }, []);

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">MailOps MVP</h1>
      <div className="flex gap-2 mb-6">
        <button onClick={ingest} className="px-3 py-2 rounded bg-black text-white" disabled={loading}>
          {loading ? 'Ingesting...' : 'Fetch USPS Digests'}
        </button>
        <button onClick={loadQueue} className="px-3 py-2 rounded border">Refresh Queue</button>
      </div>
      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.id} className="border rounded p-3">
            <div className="text-sm text-gray-600">{it.deliveryDate || '(no date found)'}</div>
            <div className="font-medium">{it.rawSenderText?.slice(0, 140) || '(no sender parsed yet)'}</div>
            <div className="text-xs text-gray-500 break-all">{it.imgHash}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
