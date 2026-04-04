import { AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild, effect, signal } from '@angular/core';
import { DomSanitizer, SafeStyle, Title } from '@angular/platform-browser';
import { timer, tap, delay, debounceTime, Subject, filter, first, switchMap, Observable, scheduled, animationFrameScheduler, throttleTime, Subscription, fromEvent, take, from, map, forkJoin } from 'rxjs';
import { TimeLineComponent } from '../time-line/time-line.component';
import { MapSelectorService } from '../map-selector.service';
import { ChronomapDatabase, TimelineItem } from '../data.service';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { State, StateService } from '../state.service';
import { LayoutService } from '../layout.service';
import { marked } from 'marked';
import { getMapHandler } from '../map-handler/map-handler';
import { FlyToOptions } from '../map-handler/map-utils';
import { MapHandler } from '../map-handler/map-handler-base';

@UntilDestroy()
@Component({
    selector: 'app-chronomap',
    templateUrl: './chronomap.component.html',
    styleUrls: ['./chronomap.component.less'],
    standalone: false
})
export class ChronomapComponent implements OnInit, AfterViewInit, OnDestroy {

  @Input() chronomap: ChronomapDatabase;  

  @ViewChild('baseMapEl', {static: true}) baseMapEl: ElementRef;
  @ViewChild('detailMapEl', {static: true}) detailMapEl: ElementRef;
  @ViewChild('timeLine') timeLineComponent: TimeLineComponent;
  @ViewChild('scroller') scrollerComponent: ElementRef;
  @ViewChild('baseMarkers') baseMarkersElement: ElementRef;
  @ViewChild('detailMarkers') detailMarkersElement: ElementRef;
  @ViewChild('description') descriptionElement: ElementRef;
  @ViewChild('detail') detail: ElementRef;

  @ViewChild('contentFiller', {static: false}) contentFiller: ElementRef<HTMLDivElement>;
  @ViewChild('contentItem', {static: false}) contentItem: ElementRef<HTMLDivElement>;
  @ViewChild('contentDescription', {static: false}) contentDescription: ElementRef<HTMLDivElement>;
  @ViewChild('contentRoot') contentRoot: ElementRef<HTMLDivElement>;

  // App State
  timelineState = signal<string | null>('');
  zoomState: string;
  detailOpen: boolean;
  contentVisible: boolean;
  currentItem: TimelineItem | null = null;
  selectedItemId: number | null = null;
  itemActivations = new Subject<any>();
  mapMode: 'Map' | 'SmallMap' | 'Media' | 'More' = 'Media';
  mapModeSetter = new Subject<'Map' | 'SmallMap' | 'Media' | 'More'>();
  fragmentChanger = new Subject<void>();
  actionSub: Subscription | null;
  observer: IntersectionObserver;

  // Layout
  resizeObserver: ResizeObserver;
  baseWidthPx: string = '100%';
  detailWidth: number;
  detailWidthPx: string = '50%';
  changing: number = 0;
  contentBackground: SafeStyle;
  backdropBackground: SafeStyle;
  
  marked = marked;
  mapHandler: MapHandler<any, any>;

  constructor(
    private titleSvc: Title, private sanitizer: DomSanitizer, public mapSelector: MapSelectorService, public state: StateService,
    private layout: LayoutService, private el: ElementRef
  ) {
    this.itemActivations.pipe(
      untilDestroyed(this),
      filter(() => this.changing === 0),
      debounceTime(1000)
    ).subscribe((item: any) => {
      console.log('ACTIVATED', item.title);
      this.itemSelected(item);
    });
    effect(() => {
      const state = this.timelineState();
      if (state) {
        this.zoomState = state;
        this.state.timelineState = state;
      }
      this.titleSvc.setTitle(this.chronomap.title());
    }, {allowSignalWrites: true});
    this.mapModeSetter.pipe(
      untilDestroyed(this),
      debounceTime(1000)
    ).subscribe((mode) => {
      this.mapMode = mode;
    });
  }

  ngOnInit(): void {
    this.chronomap.fetchContent().subscribe();
    this.backdropBackground = this.sanitizer.bypassSecurityTrustStyle(`linear-gradient(180deg, ${this.chronomap.primaryColor()}00 10.32%, ${this.chronomap.primaryColor()}80 35.85%)`);
  }

  ngAfterViewInit(): void {
    this.chronomap.ready.subscribe(() => {
      this.mapHandler = getMapHandler(this, this.layout, this.chronomap);
      this.resizeObserver = new ResizeObserver(() => {
        timer(0).subscribe(() => {
          this.syncWidths();
          this.mapHandler.resize();
        });
      });
      this.mapHandler.itemHovered.pipe(
        untilDestroyed(this),
      ).subscribe((item: TimelineItem | null) => {
        this.timeLineComponent?.updateHovers(item?.index || null);
      });
      this.mapHandler.itemSelected.pipe(
        untilDestroyed(this),
      ).subscribe((item: TimelineItem) => {
        this.itemSelected(item);
      });
      this.mapHandler.init(
        this.baseMapEl, this.detailMapEl,
        this.baseMarkersElement, this.detailMarkersElement
      );
      this.resizeObserver.observe(this.el.nativeElement);
      timer(0).subscribe(() => {
        this.syncWidths();
        this.initialize();
      });
    });
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }

  get baseWidth() {
    return this.baseMapEl?.nativeElement?.offsetWidth;
  }

  syncWidths() {
    this.baseWidthPx = this.baseWidth + 'px';
    this.detailWidth = Math.min(this.baseWidth, Math.max(450, this.baseWidth/2));
    this.detailWidthPx = this.detailWidth + 'px';
    if (this.detailOpen) {
      const el = this.scrollerComponent.nativeElement as HTMLElement;
      el.querySelector('.current')?.scrollIntoView({behavior: 'auto', inline: 'center'});
    }
  }

  getDetailWidth() {
    if (this.detailOpen) {
      if (this.mapMode === 'Map') {
        return '100%';
      } else {
        return this.detailWidthPx;
      }
    } else {
      return '0px';
    }
  }

  goto(state: State) {
    this.timelineState.set(state.timelineState);
    const item = this.chronomap.timelineItems().find(t => t.id === state.selectedItemId) || null;
    console.log('GOTO', state, item);
    this.itemSelected(item);
  }

  itemActivated(item: any) {
    if (item) {
      this.itemActivations.next(item);
    }
  }

  itemSelected(item: TimelineItem | null) {
    console.log('SELECTING ITEM?', item);
    if (item === this.currentItem) {
      return;
    }
    console.log('SELECTING ITEM', item);
    this.state.selectedItemId = item?.id || null;
    if (!item) {
      this.selectedItemId = null;
      this.currentItem = null;
      this.actionSub?.unsubscribe();
      this.actionSub = timer(0).pipe(
        tap(() => {
          if (this.detailOpen) {
            this.mapHandler.flyTo({
              padding: {top: 0, bottom: 0, left: 0, right: 0},
              duration: 1000,
            });
          }  
          this.detailOpen = false;
        }),
        delay(1000)
      ).subscribe(() => {
        this.contentVisible = false;
        this.mapHandler.updateMarkers();
        this.actionSub = null;
        this.observer?.disconnect();
      });
      return;
    }
    this.currentItem = item;
    this.selectedItemId = item.id;
    this.changing += 1;
    this.actionSub?.unsubscribe();
    let scrollBehavior: 'smooth' | 'auto' = 'smooth';
    this.actionSub = timer(0).pipe(
      tap(() => {
        this.timeLineComponent?.scrollTo(item.timestamp, item);    
      }),
      switchMap(() => {
        const el = this.scrollerComponent.nativeElement as HTMLElement;
        scrollBehavior = this.detailOpen ? 'smooth' : 'auto';
        const currentEl = el.querySelector('.current');
        if (currentEl) {
          currentEl.scrollIntoView({behavior: scrollBehavior, inline: 'center', block: 'center'});
          if (this.detailOpen) {
            return fromEvent(el, 'scrollend').pipe(
              take(1),
            );
          }
        }
        return from([true]);
      }),
      delay(0),//this.detailOpen ? 0 : 1000),
      switchMap(() => {
        const ret: Observable<any>[] = [
          from([true]),
        ];
        if (!this.detailOpen) {
          this.mapMode = 'SmallMap';
          this.contentItem.nativeElement?.scrollIntoView({behavior: 'smooth'});
          ret.push(fromEvent(this.detail.nativeElement, 'transitionend').pipe(
            take(1),
          ));
        } else {
          this.contentItem.nativeElement?.scrollIntoView({behavior: 'smooth'});
        }
        this.detailOpen = true;
        this.contentVisible = true;
        const options: FlyToOptions = {
          duration: 2,
          padding: {
            top: 0,
            bottom: 0,
            left: 0,
            right: this.layout.mobile() ? 0 : this.detailWidth,
          }
        };
        this.mapHandler.applyMapView(item, options);
        this.mapHandler.updateMarkers();
        return forkJoin(ret);
      }),
      delay(1000),
      tap(() => {
        const el = this.scrollerComponent.nativeElement as HTMLElement;
        const currentEl = el.querySelector('.current');
        if (currentEl) {
          currentEl.scrollIntoView({behavior: scrollBehavior, inline: 'center'});
        }
      }),
      delay(3000),
      tap(() => {
        this.changing -= 1;
      }),
    ).subscribe(() => {
      this.observer?.disconnect();
      this.observer = new IntersectionObserver((entries) => {
        entries = entries.filter((entry) => entry.isIntersecting).sort((a, b) => { return b.intersectionRatio - a.intersectionRatio; })
        const entry = entries[0];
        let mode: 'Map' | 'SmallMap' | 'Media' | 'More' | null = null;
        if (entry && entry.isIntersecting) {
          if (entry.target === this.contentItem?.nativeElement) {
            mode = 'Media';
          } else if (entry.target === this.contentDescription?.nativeElement) {
            mode = 'More';
          } else if (entry.target === this.contentFiller?.nativeElement) {
            mode = 'Map';
          }
          console.log('INTERSECTING', entries.length, entry.isIntersecting, entry.intersectionRatio, mode);
          if (mode) {
            this.mapModeSetter.next(mode);
          }
        }
      }, {threshold: 0.75, root: this.contentRoot.nativeElement });
      console.log('INTERSECTING start');
      this.observer.observe(this.contentItem.nativeElement);
      this.observer.observe(this.contentDescription.nativeElement);
      this.observer.observe(this.contentFiller.nativeElement);
      // TODO:
      // if (this.layout.desktop() && this.detailOpen) {
      //   const wh = window.innerHeight;
      //   const padding = 2*this.descriptionElement.nativeElement.getBoundingClientRect().top + (30 + 12) * 2 - wh;
      //   console.log('MOVE ENDED - padding', padding);
      //   for (const map of this.maps) {
      //     map.flyTo(Object.assign({}, this.lastMapState, {padding: {top: padding}}));
      //   }
      // }
      this.actionSub = null;
    });
  }

  markerColor() {
    return this.chronomap.primaryColor();
  }

  toggleMapMode() {
    if (this.mapMode === 'Map' || this.mapMode === 'SmallMap') {
      this.contentItem.nativeElement?.scrollIntoView({behavior: 'smooth'});
    } else {
      this.contentFiller.nativeElement?.scrollIntoView({behavior: 'smooth'});
    }
  }

  toggleDescriptionMode() {
    if (this.mapMode === 'More') {
      this.contentItem.nativeElement?.scrollIntoView({behavior: 'smooth'});
    } else {
      this.contentDescription.nativeElement?.scrollIntoView({behavior: 'smooth'});
    }
  }

  initialize() {
    this.chronomap.ready.pipe(
      untilDestroyed(this),
      switchMap(() => this.state.state),
    ).subscribe((state) => {
      this.goto(state);
    });
  }

  updateLocation(fragment: string, replace: boolean = false) {
    if (replace) {
      location.replace(location.pathname + '#' + fragment);
    } else {
      location.hash = fragment;
    }
  }
}
