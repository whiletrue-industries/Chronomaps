import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { marked } from 'marked';
import { first, interval, Subscription, switchMap } from 'rxjs';
import { MapSelectorService } from '../../map-selector.service';
import { ChronomapDatabase, DataService } from '../../data.service';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';

@UntilDestroy()
@Component({
    selector: 'app-add-new-bar',
    templateUrl: './add-new-bar.component.html',
    styleUrls: ['./add-new-bar.component.less'],
    host: {
        '[style.border-color]': 'chronomap.primaryColor() + "40"',
        '[class.maximized]': 'slide !== 1 && slide !== 2'
    },
    standalone: false
})
export class AddNewBarComponent implements OnInit {
  
  @Input() chronomap: ChronomapDatabase;

  @Output() close = new EventEmitter();
  
  marked = marked;
  contributeMessage: any = '';
  slide_ = 0;
  contentType = '';
  contentTypeName = '';
  selectedDate: string;
  selectedGeo: string;
  selectedProperties: any = {};
  mapSubscription: Subscription | null = null;
  timelineSubscription: Subscription | null = null;

  iframeURL: string | null = null;
  iframeSafeURL: SafeResourceUrl | null;

  nonce: string;
  subscription: Subscription | null = null;

  // Scanner state
  scannerActive = false;
  scannedImageUrl: string | null = null;
  uploadingImage = false;

  constructor(private sanitizer: DomSanitizer, public mapSelector: MapSelectorService, private data: DataService) { }

  ngOnInit(): void {
    this.chronomap.ready.pipe(first()).subscribe(() => {
      this.contributeMessage = this.sanitizer.bypassSecurityTrustHtml(marked(this.chronomap.contributeMessage()))
    });
    this.nonce = '' + (Math.floor(Math.random() * 1000000000));
  }

  selectCT(ct: string, ctName: string) {
    this.contentType = ct;
    this.contentTypeName = ctName;
    if (ct === 'image') {
      // Show scanner before proceeding to location/time selection
      this.scannerActive = true;
    } else {
      this.slide += 1;
    }
  }

  onScannerImageCaptured(blob: Blob) {
    this.scannerActive = false;
    this.uploadingImage = true;
    this.data.uploadFile(blob).subscribe({
      next: (result) => {
        this.scannedImageUrl = result.url;
        this.uploadingImage = false;
        this.slide += 1;
      },
      error: (err) => {
        console.error('Image upload failed', err);
        // Continue without the image URL so the user is not stuck
        this.uploadingImage = false;
        this.slide += 1;
      },
    });
  }

  onScannerCancelled() {
    this.scannerActive = false;
    this.contentType = '';
    this.contentTypeName = '';
  }

  get iframeSrc() {
    if (!this.selectedDate && !this.chronomap.disableTimeline()) return null;
    if (!this.contentType) return null;
    if (!this.selectedGeo) return null;
    if (!this.chronomap.newEntryForm()) return null;
    const url = new URL(this.chronomap.newEntryForm());
    console.log('PREFILL', this.contentType);
    url.searchParams.append('prefill_Media Type', this.contentType);
    url.searchParams.append('hide_Media Type', 'true');
    url.searchParams.append('prefill_Post_Timestamp', this.selectedDate + 'T00:00:00.000');
    url.searchParams.append('hide_Post_Timestamp', 'true');
    url.searchParams.append('prefill_Geo', this.selectedGeo);
    url.searchParams.append('hide_Geo', 'true');
    url.searchParams.append('prefill_Nonce', this.nonce);
    url.searchParams.append('hide_Nonce', 'true');
    url.searchParams.append('prefill_Status', 'Review');
    url.searchParams.append('hide_Status', 'true');
    url.searchParams.append('prefill_Properties', JSON.stringify(this.selectedProperties));
    url.searchParams.append('hide_Properties', 'true');
    if (this.scannedImageUrl) {
      url.searchParams.append('prefill_Scanned_Image_URL', this.scannedImageUrl);
      url.searchParams.append('hide_Scanned_Image_URL', 'true');
    }
    for (const key of Object.keys(this.selectedProperties)) {
      url.searchParams.append('hide_' + key, 'true');
      url.searchParams.append('prefill_' + key, this.selectedProperties[key]);
    }
    if (!this.iframeURL) {
      this.initPolling();
    }
    const urlStr = url.toString();
    if (this.iframeURL !== urlStr) {
      this.iframeURL = urlStr;
      this.iframeSafeURL = this.sanitizer.bypassSecurityTrustResourceUrl(this.iframeURL);
    }
    return this.iframeSafeURL;
  }

  openMap() {
    this.mapSelector.showMapSelector = true;
    this.mapSubscription?.unsubscribe();
    this.mapSubscription = this.mapSelector.mapResults.pipe(
      untilDestroyed(this)
    ).subscribe((value) => {
      console.log('GOT GEO', value);
      if (value['geo']) {
        this.selectedGeo = value['geo'];
      }
      for (const key of Object.keys(value)) {
        if (key !== 'geo') {
          this.selectedProperties[key] = value[key];
        }
      }
    });
  }

  closeMap() {
    this.mapSelector.showMapSelector = false;
    this.mapSubscription?.unsubscribe();
    this.mapSubscription = null;
  }

  openTimeline() {
    this.mapSelector.showTimelineSelector = true;
    this.timelineSubscription?.unsubscribe();
    this.timelineSubscription = this.mapSelector.timelineResults.pipe(
      untilDestroyed(this)
    ).subscribe((value) => {
      console.log('GOT DATE', value);
      if (value) {
        this.selectedDate = value;
      }
    });
  }

  closeTimeline() {
    this.mapSelector.showTimelineSelector = false;
    this.timelineSubscription?.unsubscribe();
    this.timelineSubscription = null;
  }
  
  closeMe() {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.closeMap();
    this.closeTimeline();
    this.close.emit();
  }

  initPolling() {
    this.subscription = interval(5000).pipe(
      switchMap(() => this.chronomap.fetchContent(true))
    ).subscribe((records) => {
      this.chronomap.nonces.forEach((nonce: string) => {
        if (nonce === this.nonce) {
          this.subscription?.unsubscribe();
          this.subscription = null;
          this.slide = 4;
        }
      });
    });
  }

  set slide(value: number) {
    this.slide_ = value;
    if (this.slide_ === 1) {
      this.openMap();
    } else {
      this.closeMap();
    }
    if (this.slide_ === 2) {
      if (this.chronomap.disableTimeline()) {
        this.slide = 3;
      } else {
        this.openTimeline();
      }
    } else {
      this.closeTimeline();
    }
  }

  get slide() {
    return this.slide_;
  }
}
