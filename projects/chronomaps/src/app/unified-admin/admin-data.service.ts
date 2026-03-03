import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BASEROW_ENDPOINT, BASEROW_ADMIN_TOKEN } from 'CONFIGURATION';
import { Observable, forkJoin, of, catchError, map, switchMap, tap } from 'rxjs';
import dayjs from 'dayjs';

export interface AdminItem {
  id: number;
  title: string;
  type: string;
  status: string;
  post_timestamp: Date | null;
  lastModified: Date;
  authors: string[];
  notes: string;
  content: string;
  image: string | null;
  workspaceId: number;
  workspaceName: string;
  chronomapId: string;
  chronomapName: string;
  chronomapSlug: string;
  directoryDbId: number;
}

export interface AdminChronomap {
  id: string;
  name: string;
  slug: string;
  token: string;
  directoryDbId: number;
  workspaceId: number;
  workspaceName: string;
  items: AdminItem[];
  loading: boolean;
  loaded: boolean;
}

export interface AdminWorkspace {
  id: number;
  name: string;
  directoryDbId: number;
  chronomaps: AdminChronomap[];
  loading: boolean;
  loaded: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AdminDataService {

  workspaces: AdminWorkspace[] = [];
  allItems: AdminItem[] = [];
  loading = false;
  loaded = false;
  error: string | null = null;

  constructor(private http: HttpClient) {}

  private fetchRows(tableId: number, token: string): Observable<any[]> {
    return this.http.get<any>(
      `${BASEROW_ENDPOINT}/api/database/rows/table/${tableId}/?user_field_names=true&size=200`,
      { headers: { Authorization: `Token ${token}` } }
    ).pipe(
      map((data: any) => data.results || []),
      catchError(() => of([]))
    );
  }

  private fetchTables(dbId: number, token: string): Observable<any[]> {
    return this.http.get<any[]>(
      `${BASEROW_ENDPOINT}/api/database/tables/database/${dbId}/`,
      { headers: { Authorization: `Token ${token}` } }
    ).pipe(
      catchError(() => of([]))
    );
  }

  private loadChronomapContent(chronomap: AdminChronomap): Observable<AdminItem[]> {
    const dbId = parseInt(chronomap.id, 10);
    if (!dbId) return of([]);

    return this.fetchTables(dbId, chronomap.token).pipe(
      switchMap((tables: any[]) => {
        const authorsTable = tables.find((t: any) => t.name === 'Authors');
        const contentTable = tables.find((t: any) => t.name === 'Content');
        if (!contentTable) return of([[], []] as [any[], any[]]);

        return forkJoin([
          this.fetchRows(contentTable.id, chronomap.token),
          authorsTable ? this.fetchRows(authorsTable.id, chronomap.token) : of([]),
        ] as [Observable<any[]>, Observable<any[]>]);
      }),
      map(([contentRows, authorsRows]: [any[], any[]]) => {
        return contentRows.map((row: any): AdminItem => ({
          id: row.id,
          title: row.Title || '(no title)',
          type: row.Type?.value || 'note',
          status: row.Status?.value || 'Draft',
          post_timestamp: row.Post_Timestamp ? dayjs(row.Post_Timestamp).toDate() : null,
          lastModified: row.Last_Modified ? dayjs(row.Last_Modified).toDate() : new Date(0),
          authors: (row.Authors || []).map((a: any) => a.value),
          notes: row.Notes || '',
          content: row.Content || '',
          image: row.Image?.[0]?.url || null,
          workspaceId: chronomap.workspaceId,
          workspaceName: chronomap.workspaceName,
          chronomapId: chronomap.id,
          chronomapName: chronomap.name,
          chronomapSlug: chronomap.slug,
          directoryDbId: chronomap.directoryDbId,
        }));
      }),
      tap((items: AdminItem[]) => {
        chronomap.items = items;
        chronomap.loading = false;
        chronomap.loaded = true;
        this.allItems = [...this.allItems, ...items];
      }),
      catchError(() => {
        chronomap.loading = false;
        return of([]);
      })
    );
  }

  fetchAll(): Observable<void> {
    this.loading = true;
    this.loaded = false;
    this.error = null;
    this.workspaces = [];
    this.allItems = [];

    return this.http.get<any>(`${BASEROW_ENDPOINT}/api/applications/`, {
      headers: { Authorization: `Token ${BASEROW_ADMIN_TOKEN}` }
    }).pipe(
      switchMap((response: any) => {
        let groups: any[] = [];
        if (Array.isArray(response)) {
          groups = response;
        } else if (response && Array.isArray(response.results)) {
          groups = response.results;
        }

        const dbsToTry: { id: number; name: string }[] = [];
        groups.forEach((group: any) => {
          (group.applications || [])
            .filter((app: any) => app.type === 'database')
            .forEach((app: any) => dbsToTry.push({ id: app.id, name: app.name }));
        });

        if (dbsToTry.length === 0) return of([]);

        return forkJoin(
          dbsToTry.map(db =>
            this.fetchTables(db.id, BASEROW_ADMIN_TOKEN).pipe(
              switchMap((tables: any[]) => {
                const chronomapsTable = tables.find((t: any) => t.name === 'Chronomaps');
                const settingsTable = tables.find((t: any) => t.name === 'Settings');
                if (!chronomapsTable) return of(null);

                return forkJoin([
                  this.fetchRows(chronomapsTable.id, BASEROW_ADMIN_TOKEN),
                  settingsTable ? this.fetchRows(settingsTable.id, BASEROW_ADMIN_TOKEN) : of([]),
                ]).pipe(
                  map(([rows, settingsRows]: [any[], any[]]) => {
                    const kv: any = {};
                    settingsRows.forEach((r: any) => { kv[r.Key] = r.Value; });
                    const workspaceName = kv['Title'] || db.name;

                    const workspace: AdminWorkspace = {
                      id: db.id,
                      name: workspaceName,
                      directoryDbId: db.id,
                      chronomaps: rows.map((row: any): AdminChronomap => ({
                        id: (row.Database_ID || '').toString(),
                        name: row.Title || row.Name || '',
                        slug: row.URL_Slug || '',
                        token: row.Database_Token || BASEROW_ADMIN_TOKEN,
                        directoryDbId: db.id,
                        workspaceId: db.id,
                        workspaceName,
                        items: [],
                        loading: false,
                        loaded: false,
                      })),
                      loading: false,
                      loaded: false,
                    };
                    return workspace;
                  })
                );
              }),
              catchError(() => of(null))
            )
          )
        );
      }),
      tap((results: (AdminWorkspace | null)[] | null) => {
        this.workspaces = (results || []).filter(w => w !== null) as AdminWorkspace[];
      }),
      switchMap(() => {
        const allChronomaps = this.workspaces.flatMap(w => w.chronomaps);
        if (allChronomaps.length === 0) return of([]);

        allChronomaps.forEach(c => { c.loading = true; });

        return forkJoin(
          allChronomaps
            .filter(c => !!c.id)
            .map(c => this.loadChronomapContent(c))
        );
      }),
      tap(() => {
        this.loading = false;
        this.loaded = true;
      }),
      map(() => undefined),
      catchError((err) => {
        console.error('Admin data fetch error:', err);
        this.loading = false;
        this.loaded = true;
        this.error = 'Failed to load admin data. Check the console for details.';
        return of(undefined);
      })
    );
  }
}
