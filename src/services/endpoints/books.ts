import { apiClient } from "@/services/apiClient";
import type { BookshelfPayload } from "@/types/domain";

export function getBooks(): Promise<BookshelfPayload & { ok?: boolean }> {
  return apiClient.get<BookshelfPayload & { ok?: boolean }>("/api/books");
}

export function createBook(title: string): Promise<{ ok: boolean; shelf?: BookshelfPayload }> {
  return apiClient.post<{ ok: boolean; shelf?: BookshelfPayload }>("/api/books", { title });
}

export function switchBook(bookId: string): Promise<{ ok: boolean; shelf?: BookshelfPayload }> {
  return apiClient.post<{ ok: boolean; shelf?: BookshelfPayload }>("/api/books/switch", { book_id: bookId });
}
