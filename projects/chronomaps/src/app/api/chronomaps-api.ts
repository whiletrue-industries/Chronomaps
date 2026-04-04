import { HttpClient } from "@angular/common/http";
import { Observable, expand, map, reduce, EMPTY } from "rxjs";

export class ChronomapsApi {

  constructor(private endpoint: string, private http: HttpClient) {}

  getWorkspace(workspaceId: string): Observable<any> {
    return this.http.get(`${this.endpoint}/${workspaceId}`);
  }

  getItems(workspaceId: string, pageSize = 100): Observable<any[]> {
    return this._fetchPage(workspaceId, 0, pageSize).pipe(
      expand((response: any) => {
        const nextPage = response._page + 1;
        if (response.items.length < pageSize) {
          return EMPTY;
        }
        return this._fetchPage(workspaceId, nextPage, pageSize);
      }),
      map((response: any) => response.items),
      reduce((acc: any[], items: any[]) => acc.concat(items), []),
    );
  }

  private _fetchPage(workspaceId: string, page: number, pageSize: number): Observable<any> {
    return this.http.get(`${this.endpoint}/${workspaceId}/items`, {
      params: {
        page: page.toString(),
        page_size: pageSize.toString(),
      }
    }).pipe(
      map((items: any) => ({ items: Array.isArray(items) ? items : [], _page: page }))
    );
  }
}
