import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AIRTABLE_BASE, AIRTABLE_DETAILS_FORM } from 'CONFIGURATION';
import { marked } from 'marked';
import { first, interval, Subscription, switchMap, tap } from 'rxjs';
import { ApiService } from '../api.service';
import { MapSelectorService } from '../map-selector.service';
import { TimelineMapService } from '../timeline-map.service';
import { ChronomapDatabase } from '../data.service';

@Component({
  selector: 'app-layers-bar',
  templateUrl: './layers-bar.component.html',
  styleUrls: ['./layers-bar.component.less']
})
export class LayersBarComponent implements OnInit {
  
  @Input() api: TimelineMapService;
  @Input() chronomap: ChronomapDatabase;

  @Output() close = new EventEmitter();
  @Output() addNew = new EventEmitter();
  
  constructor() { }

  ngOnInit(): void {
  }

  closeMe() {
    this.close.emit();
  }
}


