import { Component, OnInit, effect, signal } from '@angular/core';
import { ChronomapDatabase, DataService } from '../data.service';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { delay, filter, first, map, switchMap, tap, timer } from 'rxjs';
import { StateService } from '../state.service';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { marked } from 'marked';
import { LayoutService } from '../layout.service';

@UntilDestroy()
@Component({
    selector: 'app-chronomap-page',
    templateUrl: './chronomap-page.component.html',
    styleUrls: ['./chronomap-page.component.less'],
    standalone: false
})
export class ChronomapPageComponent {

  // @Input() hideHeader = false;
  LOCAL_STORAGE_KEY = 'chronomap-info-';

  slug: string | null = null;
  chronomap = signal<ChronomapDatabase | null>(null);

  _info = false;
  _addNew = false;
  _sortFilter = false;
  _layers = false;
  infoOpen = false;
  addNewOpen = false;
  sortFilterOpen = false;
  layersOpen = false;
  mobileMenu = false;

  marked = marked;

  constructor(private data: DataService, private route: ActivatedRoute, private router: Router, 
      private state: StateService, public layout: LayoutService) {
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
    });
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
    this._layers = false;
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
    this._layers = false;
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
    this._layers = false;
    if (value) {    
      this._sortFilter = value;
      timer(0).subscribe(() => {this._sortFilter = value;});
    } else {
      this._sortFilter = value;
      timer(300).subscribe(() => {this._sortFilter = value;});
    }
  }

  get layers() { return this._layers; }
  set layers(value) {
    this._info = false;
    this._addNew = false;
    this._sortFilter = false;
    if (value) {    
      this._layers = value;
      timer(0).subscribe(() => {this.layersOpen = value;});
    } else {
      this.layersOpen = value;
      timer(300).subscribe(() => {this._layers = value;});
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
