import { MapHandler } from './map-handler-base';
import { BoundsOptions, FlyToOptions, MapUtils } from './map-utils';
import { timer } from 'rxjs';
import { TimelineItem } from '../data.service';

import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import mapboxgl, { Map } from "mapbox-gl";

export class MapHandlerMapbox extends MapHandler<mapboxgl.Map, mapboxgl.Marker> {

  override initMaps(): mapboxgl.Map[] {
    (mapboxgl as any).accessToken = this.chronomap.mapboxKey();
    let initCount = 0;
    this.baseMap = new mapboxgl.Map({
      container: this.baseMapEl.nativeElement,
      style: this.chronomap.backgroundMapStyle(),
      minZoom: 3,
      attributionControl: false,
      logoPosition: 'bottom-right',
    });
    this.baseMap.addControl(new mapboxgl.AttributionControl({compact: true}), 'top-right');
    this.baseMap.on('style.load', () => {
      initCount += 1;
      if (initCount === 2) {
        this.initMapsComplete();
      }
    });
    this.detailMap = new mapboxgl.Map({
      container: this.detailMapEl.nativeElement,
      style: this.chronomap.mapStyle(),
      minZoom: 3,
      attributionControl: false,
      logoPosition: 'bottom-right',
    });
    const maps = [this.baseMap, this.detailMap];
    if (this.layout.desktop()) {
      this.baseMap.addControl(new mapboxgl.NavigationControl(), 'top-left');
      this.detailMap.addControl(new mapboxgl.NavigationControl(), 'top-left');
    }
    this.detailMap.on('style.load', () => {
      for (const map of this.maps) {
        map.on('move', () => {
          const center = map.getCenter();
          const padding = map.getPadding();
          const jumpTo: FlyToOptions = {
            center: {
              lat: center.lat,
              lon: center.lng,
            },
            zoom: map.getZoom(),
            pitch: map.getPitch(),
            bearing: map.getBearing(),
            padding: {
              top: padding.top || 0,
              bottom: padding.bottom || 0,
              left: padding.left || 0,
              right: padding.right || 0,
            }
          };
          this.mapSyncMoveStart(map, jumpTo);
        });
        map.on('moveend', () => {
          this.mapSyncMoveEnd();
        });
      }
      initCount += 1;
      if (initCount === 2) {
        this.initMapsComplete();
      }
    });
    return maps;
  }

  override mapResize(map: Map): void {
    map.resize();
  }

  override mapFlyTo(map: Map, options: FlyToOptions): void {      
    options = Object.assign({}, {
      center: this.baseMap.getCenter(),
      zoom: this.baseMap.getZoom(),
      bearing: this.baseMap.getBearing(),
      pitch: this.baseMap.getPitch(),
    }, options);
    map.flyTo(options);
  }

  override mapJumpTo(map: Map, options: FlyToOptions): void {
    map.jumpTo(options);
  }

  override mapApplyLayers(map: Map, layers: string[], offLayers: string[]): void {
    for (const l of layers || []) {
      if (map.getLayer(l)) {
        map.setLayoutProperty(l, 'visibility', 'visible');
      }
    }
    for (const l of offLayers || []) {
      if (map.getLayer(l)) {
        map.setLayoutProperty(l, 'visibility', 'none');
      }
    }
  }

  override mapRemove(map: Map): void {
    map.remove();
  }

  override initSelectorMapAux(el: HTMLElement, position: FlyToOptions, interactive: boolean): Map {
    const map = new mapboxgl.Map({
      container: el,
      style: this.chronomap.backgroundMapStyle(),
      minZoom: 3,
      center: position.center,
      zoom: position.zoom,
      bearing: position.bearing,
      pitch: position.pitch,
      interactive,
    });
    map.on('load', () => {
      // const options = MapService.parseMapView(this.chronomap.mapView());
      map.jumpTo(position);
    });

    if (interactive) {
      var geocoder = new MapboxGeocoder({
        accessToken: mapboxgl.accessToken as string,
        marker: false,
      });
      map.addControl(geocoder);
      map.addControl(new mapboxgl.NavigationControl({visualizePitch: true}), 'top-left');
      map.on('moveend', () => {
        const center = map.getCenter();
        const position: FlyToOptions = {
          center: {
            lat: center.lat,
            lon: center.lng,
          },
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        };
        this.selectorMapOnMove(position);
      });
    }
    return map;
  }

  override mapFitBounds(map: Map, bounds: BoundsOptions): void {
    const mpBounds = new mapboxgl.LngLatBounds(bounds[0], bounds[1]);
    map.fitBounds(mpBounds, {animate: false, padding: 50});
  }

  override markerCreate(el: HTMLElement, coordinates: { lat: number; lon: number }, map: Map, draggable = false): mapboxgl.Marker {
    return new mapboxgl.Marker(el, {draggable})
      .setLngLat(coordinates)
      .addTo(map);
  }

  override onMarkerDragEnd(marker: mapboxgl.Marker, item: TimelineItem): void {
    marker.on('dragend', () => {
      const lngLat = marker.getLngLat();
      this.itemDragged.next({item, lat: lngLat.lat, lon: lngLat.lng});
    });
  }

  override markerRemove(marker: mapboxgl.Marker): void {
    marker.remove();
  }

  override pauseSync(seconds: number): void {
    // Do nothing
  }

  override processFlyToOptions(options: FlyToOptions): void {
    // Do nothing
  }
}
