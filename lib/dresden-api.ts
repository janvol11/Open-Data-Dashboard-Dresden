import { DresdenDataset } from "@/types/dresden-data";

export async function searchDresdenDatasets(
  query = "",
  start = 0,
  rows = 50
): Promise<{ datasets: DresdenDataset[]; total: number }> {
  const params = new URLSearchParams({ q: query, start: String(start), rows: String(rows) });
  const response = await fetch(`/api/dresden-search?${params}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return (await response.json()) as { datasets: DresdenDataset[]; total: number };
}
