import { HttpClient } from "@angular/common/http";
import { from, map, tap } from "rxjs";

export class BaserowTable {

    rows: any[] = [];
    hasRows = false;

    constructor(private endpoint: string, public token: string, public id: number, public name: string) {
    }

    fetchRows(http: HttpClient, force = false) {
        if (!this.hasRows || force) {
            return http.get(`${this.endpoint}/api/database/rows/table/${this.id}/?user_field_names=true&size=100`, {
                headers: {
                    Authorization: `Token ${this.token}`
                }
            }).pipe(
                map((data: any) => data.results),
                tap((data: any) => {
                    this.rows = data;
                    this.hasRows = true;
                }),
                map(() => this)
            );    
        } else {
            return from([this]);
        }
    }

    updateRow(http: HttpClient, rowId: number, data: any) {
        return http.patch(`${this.endpoint}/api/database/rows/table/${this.id}/${rowId}/?user_field_names=true`, data, {
            headers: {
                Authorization: `Token ${this.token}`
            }
        });
    }

    createRow(http: HttpClient, data: any) {
        return http.post(`${this.endpoint}/api/database/rows/table/${this.id}/?user_field_names=true`, data, {
            headers: {
                Authorization: `Token ${this.token}`
            }
        });
    }
}
