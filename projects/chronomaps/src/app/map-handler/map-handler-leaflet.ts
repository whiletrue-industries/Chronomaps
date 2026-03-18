import { timer } from 'rxjs';
import { MapHandler } from './map-handler-base';
import { BoundsOptions, FlyToOptions, MapUtils } from './map-utils';
import { TimelineItem } from '../data.service';
import * as L from 'leaflet';
import 'leaflet.sync';

export class MapHandlerLeaflet extends MapHandler<L.Map, L.Marker> {

  private getBgLayer(): L.ImageOverlay | null {
    const backgroundUrl = this.chronomap.Map_BG();
    const boundsCommaSeparated = this.chronomap.Map_BG_Bounds();
    if (!backgroundUrl || !boundsCommaSeparated) {
      return null;
    }
    const bounds = boundsCommaSeparated.split(',').map(parseFloat);
    return L.imageOverlay(backgroundUrl, [[bounds[0], bounds[1]], [bounds[2], bounds[3]]]);
  }

  private makeMap(el: HTMLElement): L.Map {
    const map = L.map(el, {
      crs: L.CRS.Simple,
      maxBounds: [[-3, -3], [3, 5]],
      center: [0, 0],
      zoom: 9,
      minZoom: 9,
      maxZoom: 12,
      zoomControl: false,
      attributionControl: false,
    });
    this.getBgLayer()?.addTo(map);
    if (this.layout.desktop()) {
      map.addControl(L.control.zoom({ position: 'topleft' }));
    }
    return map;
  }

  override initMaps(): L.Map[] {
    let initCount = 0;
    this.baseMap = this.makeMap(this.baseMapEl.nativeElement);
    this.detailMap = this.makeMap(this.detailMapEl.nativeElement);

    L.tileLayer(this.chronomap.mapStyle()).addTo(this.detailMap);
    const maps = [this.baseMap, this.detailMap];
    this.baseMap.whenReady(() => {
      initCount += 1;
      if (initCount === 2) {
        this.initMapsComplete();
      }
    });
    this.detailMap.whenReady(() => {
      this.detailMap.on('move', () => {
        const center = this.detailMap.getCenter();
        this.lastMapState = {
          center: {
            lat: center.lat,
            lon: center.lng,
          },
          zoom: this.detailMap.getZoom(),
        };
      });
      initCount += 1;
      if (initCount === 2) {
        console.log('SYNC MAPS');
        this.baseMap.sync(this.detailMap);
        this.detailMap.sync(this.baseMap);
        this.initMapsComplete();
      }
    });
    return maps;
  }

  override mapResize(map: L.Map): void {
    map.invalidateSize();
  }

  override mapFlyTo(map: L.Map, options: FlyToOptions): void {      
    options = Object.assign({}, {
      center: map.getCenter(),
      zoom: map.getZoom(),
    }, options);
    map.flyTo({
      lat: options.center?.lat || 0,
      lng: options.center?.lon || 0,
    }, options.zoom, options);
  }

  override mapJumpTo(map: L.Map, options: FlyToOptions): void {
    options = Object.assign({}, {
      center: map.getCenter(),
      zoom: map.getZoom(),
    }, options);
    map.flyTo({
      lat: options.center?.lat || 0,
      lng: options.center?.lon || 0,
    }, options.zoom, {
      animate: false,
      duration: 0,
    });
  }

  override mapApplyLayers(map: L.Map, layers: string[], offLayers: string[]): void {
  }

  override mapRemove(map: L.Map): void {
    map.remove();
  }

  override initSelectorMapAux(el: HTMLElement, position: FlyToOptions, interactive: boolean): L.Map {
    const map = new L.Map(el, {
      crs: L.CRS.Simple,
      center: [position.center?.lat || 0, position.center?.lon || 0],
      zoom: position.zoom || 9,      
      maxBounds: [[-3, -3], [3, 5]],
      minZoom: 9,
      maxZoom: 12,
      attributionControl: false,
      dragging: interactive,     
      zoomControl: interactive, 
    })
    timer(100).subscribe(() => {
      map.invalidateSize();
    });
    this.getBgLayer()?.addTo(map);
    map.on('load', () => {
      this.mapJumpTo(map, position);
    });
    if (interactive) {
      map.on('click', (e) => {
        console.log('MARKER CLICK', e.latlng);
      });
      map.on('moveend', () => {
        const center = map.getCenter();
        const position: FlyToOptions = {
          center: {
            lat: center.lat,
            lon: center.lng,
          },
          zoom: map.getZoom(),
        };
        this.selectorMapOnMove(position);
      });
    }
    return map;
  }

  override mapFitBounds(map: L.Map, bounds: BoundsOptions): void {
    const mpBounds = new L.LatLngBounds(bounds[0], bounds[1]);
    map.fitBounds(mpBounds, {animate: false, padding: [50, 50]});
  }

  override markerCreate(el: HTMLElement, coordinates: { lat: number; lon: number }, map: L.Map, draggable = false): L.Marker {
    const icon = L.divIcon({
      html: el,
      iconSize: [el.offsetWidth, el.offsetHeight],
      className: 'leaflet-marker',
    });
    return L.marker([coordinates.lat, coordinates.lon], {icon, draggable}).addTo(map);
  }

  override onMarkerDragEnd(marker: L.Marker, item: TimelineItem): void {
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      this.itemDragged.next({item, lat: pos.lat, lon: pos.lng});
    });
  }

  override markerRemove(marker: L.Marker): void {
    marker.remove();
  }

  override pauseSync(seconds: number): void {
    this.baseMap.unsync(this.detailMap);
    this.detailMap.unsync(this.baseMap);
    timer(seconds * 1000).subscribe(() => {
      
      this.baseMap.sync(this.detailMap, {noInitialSync: true});
      this.detailMap.sync(this.baseMap, {noInitialSync: true});
    });
  }

  override processFlyToOptions(options: FlyToOptions): void {
    if (options.padding?.right && options.center && options.zoom) {
      const center = {
        lat: options.center.lat,
        lng: options.center.lon,
      }
      const targetPoint = this.detailMap.project(center, options.zoom).add([options.padding.right / 2, 0])
      const targetLatLng = this.detailMap.unproject(targetPoint, options.zoom);
      options.center = {
        lat: targetLatLng.lat,
        lon: targetLatLng.lng,
      };
    }
  }
}
