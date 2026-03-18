import { ElementRef } from "@angular/core";
import { debounceTime, delay, Observable, Subject, tap, timer } from "rxjs";
import { ChronomapDatabase, TimelineItem } from "../data.service";
import { LayoutService } from "../layout.service";
import { FlyToOptions, BoundsOptions, MapUtils, LatLon } from "./map-utils";

export abstract class MapHandler<T, M> {
  detailMapEl: ElementRef<any>;
  baseMapEl: ElementRef<any>;
  baseMarkersEl: ElementRef<any>;
  detailMarkersEl: ElementRef<any>;
  
  baseMap: T;
  detailMap: T;
  maps: T[] = [];
  selectorMap: T | null = null;

  lastMapState: FlyToOptions;
  
  itemSelected = new Subject<TimelineItem>();
  itemHovered = new Subject<TimelineItem | null>();
  itemDragged = new Subject<{item: TimelineItem, lat: number, lon: number}>();
  selectorMapMoved = new Subject<{geo: string, position: FlyToOptions}>();

  canDragItem: ((item: TimelineItem) => boolean) | null = null;

  // Internal
  syncing: boolean;
  moveEnd = new Subject<void>();
  moveEnded: Observable<void>;
  markers: M[] = []

  constructor(protected owner: any, protected layout: LayoutService, protected chronomap: ChronomapDatabase) {
    this.moveEnded = this.moveEnd.pipe(
      debounceTime(1000)
    );
  }
  
  public init(
    base: ElementRef, detail: ElementRef,
    baseMarkers: ElementRef, detailMarkers: ElementRef,
  ) {
    this.baseMapEl = base;
    this.detailMapEl = detail;
    this.baseMarkersEl = baseMarkers;
    this.detailMarkersEl = detailMarkers;
    this.maps = this.initMaps();
    this.baseMap = this.maps[0];
    this.detailMap = this.maps[1];
    this.updateMarkers();
  }

  public resize() {
    this.maps.forEach((map) => {
      this.mapResize(map);
    });
    if (this.selectorMap) {
      this.mapResize(this.selectorMap);
    }
  }

  public flyTo(options: FlyToOptions) {
    this.mapFlyTo(this.baseMap, options);
  }

  public applyMapView(item: TimelineItem, extraOptions: any = null) {
    const options = Object.assign({}, MapUtils.parseMapView(item.geo), extraOptions || {});
    this.processFlyToOptions(options);
    this.mapApplyLayers(this.detailMap, item.map_layers, item.off_map_layers);
    if (options.duration) {
      this.pauseSync(options.duration + 1);
    }
    this.mapFlyTo(this.detailMap, options);
    this.mapFlyTo(this.baseMap, options);
  }

  public initSelectorMap(el: HTMLElement, position: FlyToOptions, interactive=false) {
    this.selectorMap = this.initSelectorMapAux(el, position, interactive);
  }

  public clearSelectorMap() {
    if (this.selectorMap) {
      this.mapRemove(this.selectorMap);
      this.selectorMap = null;
    }
  }

  abstract initMaps(): T[];
  abstract initSelectorMapAux(el: HTMLElement, position: FlyToOptions, interactive: boolean): T;
  abstract mapRemove(map: T): void
  abstract mapResize(map: T): void;
  abstract mapFlyTo(map: T, options: FlyToOptions): void;
  abstract mapJumpTo(map: T, options: FlyToOptions): void;
  abstract mapFitBounds(map: T, bounds: BoundsOptions): void;
  abstract mapApplyLayers(map: T, mapLayers: string[], offMapLayers: string[]): void;
  abstract markerCreate(el: HTMLElement, coordinates: LatLon, map: T, draggable?: boolean): M;
  abstract markerRemove(marker: M): void;
  abstract pauseSync(seconds: number): void;
  abstract processFlyToOptions(options: FlyToOptions): void;

  protected initMapsComplete() {
    this.updateMarkers();
    timer(100).pipe(
      tap(() => {
        if (this.chronomap.mapView()) {
          this.mapFlyTo(this.baseMap, MapUtils.parseMapView(this.chronomap.mapView()));
        } else {
          // Calculate bounds and fit to them
          let maxLat = -90;
          let minLat = 90;
          let maxLon = -180;
          let minLon = 180;
          this.chronomap.timelineItems().forEach((item) => {
            const options = MapUtils.parseMapView(item.geo);
            const coordinates = options.center as { lon: number; lat: number };
            maxLat = Math.max(maxLat, coordinates.lat);
            minLat = Math.min(minLat, coordinates.lat);
            maxLon = Math.max(maxLon, coordinates.lon);
            minLon = Math.min(minLon, coordinates.lon);
          });
          const bounds: BoundsOptions = [[minLon, minLat], [maxLon, maxLat]];
          console.log('FIT BOUNDS', bounds);
          this.mapFitBounds(this.baseMap, bounds);
        }
      }),
      delay(0),
      tap(() => {
        window.dispatchEvent(new Event('resize'));
      })
    ).subscribe();
  }

  protected mapSyncMoveStart(map: T, position: FlyToOptions) {
    if (!this.syncing) {
      this.syncing = true;
      this.lastMapState = {
        center: position.center,
        zoom: position.zoom,
        pitch: position.pitch,
        bearing: position.bearing,
      };
      for (const otherMap of this.maps) {
        if (map !== otherMap) {
          this.mapJumpTo(otherMap, position);
        }
      }
      this.syncing = false;
    }
  }

  protected mapSyncMoveEnd() {
    timer(1000).subscribe(() => {
      this.moveEnd.next();
    });
  }

  protected selectorMapOnMove(position: FlyToOptions) {
    const params = [position.zoom, position.center?.lat, position.center?.lon, position?.bearing, position?.pitch]
    const geo = 'https://labs.mapbox.com/location-helper/#' + params.map(p => Number.isFinite(p) ? p?.toString() : '').join('/');
    this.selectorMapMoved.next({
      geo,
      position
    });
  }

  updateMarkers() {
    this.markers.forEach((marker) => {
      this.markerRemove(marker);
    });
    this.markers = [];
    timer(100).subscribe(() => {
      const conf: {el: HTMLElement, map: T}[] = [
        {el: this.baseMarkersEl.nativeElement, map: this.baseMap},
        {el: this.detailMarkersEl.nativeElement, map: this.detailMap},
      ];
      for (const c of conf) {
        const markers = c.el.children;
        for (let i=0; i<markers.length; i++) {
          const markerEl = markers[i] as HTMLElement; 
          const item = this.chronomap.timelineItems()[i];
          const options = MapUtils.parseMapView(item.geo);
          const coordinates = options.center as LatLon;
          const clonedElement = markerEl.cloneNode(true) as HTMLElement;
          clonedElement.addEventListener('click', () => {
            console.log('CLICK', item.title);
            this.itemSelected.next(item);
          });
          clonedElement.addEventListener('mouseenter', () => {
            this.itemHovered.next(item);
          });
          clonedElement.addEventListener('mouseleave', () => {
            this.itemHovered.next(null);
          });
          const draggable = !!(this.canDragItem && this.canDragItem(item));
          const marker = this.markerCreate(clonedElement, coordinates, c.map, draggable);
          if (draggable) {
            this.onMarkerDragEnd(marker, item);
          }
          this.markers.push(marker);
        }
      }
    });
  }

  protected onMarkerDragEnd(marker: M, item: TimelineItem): void {
    // Override in subclasses to handle drag end events
  }
}