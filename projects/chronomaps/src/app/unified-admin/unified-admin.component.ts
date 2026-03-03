import { Component, OnInit } from '@angular/core';
import { AdminDataService, AdminChronomap, AdminItem } from './admin-data.service';

@Component({
  selector: 'app-unified-admin',
  templateUrl: './unified-admin.component.html',
  styleUrls: ['./unified-admin.component.less'],
  standalone: false
})
export class UnifiedAdminComponent implements OnInit {

  selectedWorkspaceId = '';
  selectedChronomapId = '';
  statusFilter = '';
  typeFilter = '';
  searchQuery = '';

  readonly contentTypes = ['audio', 'image', 'video', 'news', 'note', 'twitter', 'instagram', 'wikipedia'];
  readonly statuses = ['Draft', 'Review', 'Published'];

  constructor(public adminData: AdminDataService) {}

  ngOnInit(): void {
    if (!this.adminData.loaded && !this.adminData.loading) {
      this.adminData.fetchAll().subscribe();
    }
  }

  get filteredChronomaps(): AdminChronomap[] {
    if (!this.selectedWorkspaceId) {
      return this.adminData.workspaces.flatMap(w => w.chronomaps);
    }
    const ws = this.adminData.workspaces.find(w => w.id.toString() === this.selectedWorkspaceId);
    return ws?.chronomaps || [];
  }

  get filteredItems(): AdminItem[] {
    let items = this.adminData.allItems;

    if (this.selectedWorkspaceId) {
      items = items.filter(i => i.workspaceId.toString() === this.selectedWorkspaceId);
    }
    if (this.selectedChronomapId) {
      items = items.filter(i => i.chronomapId === this.selectedChronomapId);
    }
    if (this.statusFilter) {
      items = items.filter(i => i.status === this.statusFilter);
    }
    if (this.typeFilter) {
      items = items.filter(i => i.type === this.typeFilter);
    }
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      items = items.filter(i =>
        i.title.toLowerCase().includes(q) ||
        i.content?.toLowerCase().includes(q) ||
        i.notes?.toLowerCase().includes(q)
      );
    }

    return items.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  }

  onWorkspaceChange(): void {
    this.selectedChronomapId = '';
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'Published': return 'status-published';
      case 'Review':    return 'status-review';
      default:          return 'status-draft';
    }
  }

  totalChronomaps(): number {
    return this.adminData.workspaces.reduce((acc, w) => acc + w.chronomaps.length, 0);
  }
}
