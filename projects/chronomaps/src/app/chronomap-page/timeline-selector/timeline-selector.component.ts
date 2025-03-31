import { AfterViewInit, Component, ElementRef, Input, OnInit, ViewChild, effect, signal } from '@angular/core';

import { MapSelectorService } from '../../map-selector.service';
import { ChronomapDatabase } from '../../data.service';
import { FlyToOptions } from '../../map-handler/map-utils';
import { MapHandler } from '../../map-handler/map-handler-base';

@Component({
    selector: 'app-timeline-selector',
    templateUrl: './timeline-selector.component.html',
    styleUrls: ['./timeline-selector.component.less'],
    standalone: false
})
export class TimelineSelectorComponent implements AfterViewInit, OnInit {

  @Input() chronomap: ChronomapDatabase;
  @Input() mapHandler: MapHandler<any, any>;
  @Input() position: FlyToOptions;

  @ViewChild('mapEl', {static: true}) mapEl: ElementRef;

  minDate: Date;
  maxDate: Date;

  date = signal<Date>(new Date());
  includeTime = signal<boolean>(false);
  
  constructor(public mapSelector: MapSelectorService) {
    effect(() => {
      console.log('SELECTED DATE', this.date().toISOString());
      if (this.includeTime()) {
        const date = this.date();
        date.setSeconds(0);
        date.setMilliseconds(0);
        const timestamp = this.date().toISOString();
        let nice = this.date().toLocaleString();
        // remove seconds, last 3 chars
        nice = nice.substring(0, nice.length - 3);
        this.mapSelector.submitTimelineResult(timestamp, nice);
      } else {
        const timestamp = this.date().toISOString().split('T')[0];
        const nice = this.date().toLocaleDateString();
        this.mapSelector.submitTimelineResult(timestamp, nice);
      }
    });
  }

  ngOnInit(): void {
      const minDate = this.chronomap.minDate();
      const maxDate = this.chronomap.maxDate();
      const delta = (maxDate.getTime() - minDate.getTime()) + 1000 * 60 * 60 * 24;
      this.minDate = new Date(minDate.getTime() - delta);
      this.maxDate = new Date(maxDate.getTime() + delta);

  }

  ngAfterViewInit(): void {
    this.chronomap.ready.subscribe(() => {
      this.mapHandler.initSelectorMap(this.mapEl.nativeElement, this.position);
    });
  }
}
