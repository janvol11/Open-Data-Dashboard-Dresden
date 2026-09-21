import { DresdenDataset } from "@/types/dresden-data";

/** Durchsucht die lokale /api/dresden-search-Route (umgeht CORS der CKAN-API). */
export async function searchDresdenDatasets(query: string = "", start: number = 0, rows: number = 10): Promise<{ datasets: DresdenDataset[], total: number }> {
  try {
    const params = new URLSearchParams();
    if (query) params.append("q", query);
    params.append("start", start.toString());
    params.append("rows", rows.toString());

    const response = await fetch(`/api/dresden-search?${params.toString()}`);
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error: unknown) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}
