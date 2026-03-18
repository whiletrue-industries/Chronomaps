import { Injectable, signal } from '@angular/core';
import { ChronomapDatabase, ContentItem, TimelineItem } from './data.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  adminKey = signal<string | null>(null);
  itemKey = signal<string | null>(null);

  initFromParams(params: {[k: string]: string}) {
    if (params['admin_key']) {
      this.adminKey.set(params['admin_key']);
    }
    if (params['item_key']) {
      this.itemKey.set(params['item_key']);
    }
  }

  isAdmin(chronomap: ChronomapDatabase): boolean {
    const key = this.adminKey();
    const storedKey = chronomap.adminKey();
    return !!(key && storedKey && key === storedKey);
  }

  isDragAllActive(chronomap: ChronomapDatabase): boolean {
    const expiry = chronomap.drag_all_expiry();
    return !!expiry && expiry > new Date();
  }

  canDragItem(item: ContentItem, chronomap: ChronomapDatabase): boolean {
    if (this.isAdmin(chronomap)) {
      return true;
    }
    if (this.isDragAllActive(chronomap)) {
      return true;
    }
    const key = this.itemKey();
    if (!key) {
      return false;
    }
    // Item key matches item's nonce directly
    if (key === item.nonce) {
      return true;
    }
    // Item key matches another item by the same author(s)
    const keyItem = chronomap.allContentItems?.find((i: ContentItem) => i.nonce === key);
    if (keyItem) {
      const keyAuthors = keyItem.authors.map((a) => a.email).filter(Boolean);
      const itemAuthors = item.authors.map((a) => a.email).filter(Boolean);
      if (keyAuthors.length > 0 && keyAuthors.some((a) => itemAuthors.includes(a))) {
        return true;
      }
    }
    return false;
  }
}
