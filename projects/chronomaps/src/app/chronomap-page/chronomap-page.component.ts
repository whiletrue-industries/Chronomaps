import { Component, OnDestroy, effect, signal } from '@angular/core';
import { ChronomapDatabase, DataService } from '../data.service';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { delay, filter, first, interval, map, switchMap, tap, timer } from 'rxjs';
import { StateService } from '../state.service';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { marked } from 'marked';
import { LayoutService } from '../layout.service';
import { AuthService } from '../auth.service';

@UntilDestroy()
@Component({
    selector: 'app-chronomap-page',
    templateUrl: './chronomap-page.component.html',
    styleUrls: ['./chronomap-page.component.less'],
    standalone: false
})
export class ChronomapPageComponent implements OnDestroy {

  // @Input() hideHeader = false;
  LOCAL_STORAGE_KEY = 'chronomap-info-';

  slug: string | null = null;
  chronomap = signal<ChronomapDatabase | null>(null);

  _info = false;
  _addNew = false;
  _sortFilter = false;
  infoOpen = false;
  addNewOpen = false;
  sortFilterOpen = false;
  mobileMenu = false;

  // Drag mode countdown
  dragCountdownSeconds = signal<number>(0);
  private countdownInterval: any = null;

  marked = marked;

  constructor(private data: DataService, private route: ActivatedRoute, private router: Router, 
      private state: StateService, public layout: LayoutService, public auth: AuthService) {
    this.route.params.pipe(
      first(),
      tap((params) => {
        const dbId = parseInt(params['dbid']);
        this.data.fetchData(dbId);
        this.slug = params['slug'];
        this.loadChronomap(this.data.directory.chronomaps(), this.slug);
      }),
      delay(3000),
    ).subscribe(() => {
      this.info = localStorage.getItem(this.storageKey) !== 'opened';
    });
    effect(() => {
      const chronomaps = this.data.directory.chronomaps();
      this.loadChronomap(chronomaps, this.slug);
    }, {allowSignalWrites: true});
    this.router.events.pipe(
      untilDestroyed(this),
      filter((event) => event instanceof NavigationEnd),
      map((event) => {
        const ne = event as NavigationEnd;
        const url = new URL('http://example.com' + ne.url);
        const params = Object.fromEntries(url.searchParams);
        const fragment = url.hash.slice(1);
        return {
          fragment,
          params,
        };
      })
    ).subscribe(({fragment, params}) => {
      this.state.initFromUrl(fragment, params);
      this.auth.initFromParams(params);
    });
    // Also read URL params on initial load
    const initialUrl = new URL('http://example.com' + this.router.url);
    const initialParams = Object.fromEntries(initialUrl.searchParams);
    this.auth.initFromParams(initialParams);
    // Countdown timer
    this.countdownInterval = setInterval(() => {
      const chronomap = this.chronomap();
      if (!chronomap) {
        this.dragCountdownSeconds.set(0);
        return;
      }
      const expiry = chronomap.drag_all_expiry();
      if (!expiry) {
        this.dragCountdownSeconds.set(0);
        return;
      }
      const remaining = Math.max(0, Math.floor((expiry.getTime() - Date.now()) / 1000));
      this.dragCountdownSeconds.set(remaining);
      if (remaining === 0) {
        chronomap.drag_all_expiry.set(null);
      }
    }, 1000);
    // Poll for drag_all changes every 30 seconds
    interval(30000).pipe(
      untilDestroyed(this),
    ).subscribe(() => {
      const chronomap = this.chronomap();
      if (chronomap) {
        chronomap.refreshDragAllExpiry().subscribe();
      }
    });
  }

  ngOnDestroy() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
  }

  get isDragModeActive(): boolean {
    const chronomap = this.chronomap();
    return !!chronomap && this.auth.isDragAllActive(chronomap);
  }

  get isAdmin(): boolean {
    const chronomap = this.chronomap();
    return !!chronomap && this.auth.isAdmin(chronomap);
  }

  get hasItemKey(): boolean {
    return !!this.auth.itemKey();
  }

  get dragCountdownFormatted(): string {
    const total = this.dragCountdownSeconds();
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  enableDragMode() {
    const chronomap = this.chronomap();
    if (!chronomap) return;
    const expiry = new Date(Date.now() + 15 * 60 * 1000);
    chronomap.setDragAllExpiry(expiry).subscribe();
  }

  disableDragMode() {
    const chronomap = this.chronomap();
    if (!chronomap) return;
    chronomap.setDragAllExpiry(null).subscribe();
  }

  adjustDragTime(minutes: number) {
    const chronomap = this.chronomap();
    if (!chronomap) return;
    const expiry = chronomap.drag_all_expiry();
    if (!expiry) return;
    const newExpiry = new Date(expiry.getTime() + minutes * 60 * 1000);
    if (newExpiry > new Date()) {
      chronomap.setDragAllExpiry(newExpiry).subscribe();
    } else {
      chronomap.setDragAllExpiry(null).subscribe();
    }
  }

  loadChronomap(chronomaps: ChronomapDatabase[], slug: string | null) {
    if (slug && chronomaps.length > 0) {
      const chronomap = chronomaps.find(c => c.slug() === slug);
      if (chronomap) {
        chronomap.fetchMeta().pipe(
          switchMap(() => chronomap.fetchContent()),
        ).subscribe(() => {
          this.chronomap.set(chronomap);
        });
      }
    }
  }
    
  get info() { return this._info; }
  set info(value) {
    console.log('INFO=', value);
    this._addNew = false;
    this._sortFilter = false;
    localStorage.setItem(this.storageKey, 'opened');
    if (value) {
      this._info = value;
      timer(0).subscribe(() => {this.infoOpen = value;});
    } else {
      this.infoOpen = value;
      timer(300).subscribe(() => {this._info = value;});
    }
  }

  get addNew() { return this._addNew; }
  set addNew(value) {
    this._info = false;
    this._sortFilter = false;
    if (value) {
      this._addNew = value;
      timer(0).subscribe(() => {this.addNewOpen = value;});  
    } else {
      this.addNewOpen = value;
      timer(300).subscribe(() => {this._addNew = value;});
    }
  }

  get sortFilter() { return this._sortFilter; }
  set sortFilter(value) {
    this._info = false;
    this._addNew = false;
    if (value) {    
      this._sortFilter = value;
      timer(0).subscribe(() => {this._sortFilter = value;});
    } else {
      this._sortFilter = value;
      timer(300).subscribe(() => {this._sortFilter = value;});
    }
  }

  get chronomap_(): ChronomapDatabase {
    const chronomap = this.chronomap();
    if (chronomap) {
      return chronomap;
    }
    return {} as ChronomapDatabase;
  }

  get storageKey() {
    return this.LOCAL_STORAGE_KEY + this.slug;
  }
}
