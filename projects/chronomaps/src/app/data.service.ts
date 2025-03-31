import { Injectable, effect, signal } from '@angular/core';

import { BASEROW_ENDPOINT, BASEROW_ADMIN_TOKEN } from 'CONFIGURATION';
import { BaserowDatabase } from './baserow/baserow-database';
import { HttpClient } from '@angular/common/http';
import { Observable, ReplaySubject, Subject, forkJoin, from, map, switchMap, tap } from 'rxjs';
import dayjs from 'dayjs';
import { MapUtils } from './map-handler/map-utils';

export type Author = {
  name: string;
  email: string;
  status: 'Pending' | 'Editor' | 'Contributor';
};

type DateFormatter = (date: Date) => string;
const FORMATTERS: {[key: string]: DateFormatter} = {
  day: (date: Date) => dayjs(date).format('MMMM D, YYYY'),
  month: (date: Date) => dayjs(date).format('MMMM YYYY'),
  year: (date: Date) => dayjs(date).format('YYYY'),
  hour: (date: Date) => dayjs(date).format('MMMM D, YYYY h:mm a'),
};

export class ContentItem {
  id: number;
  title: string;
  notes: string;
  post_timestamp: Date;
  alt_post_timestamp: Date;
  status: 'Draft' | 'Review' | 'Published'; 
  type: 'audio' | 'wikipedia' | 'instagram' | 'twitter' | 'image' | 'video' | 'news' | 'note';
  youtube_video_id: string;
  content: string;
  image: string;
  audio: string;
  name: string;
  username: string;
  profile_image: string;
  like_count: number;
  comment_count: number;
  link_title: string;
  link_domain: string;
  geo: string;
  map_layers: string[];
  off_map_layers: string[];
  nonce: string;
  authors: Author[];
  tags: string[];
  related: ContentItem[];
  lastModified: Date;
  extraProperties: [string, any][];
};

export class TimelineItem extends ContentItem {
  index: number;
  next: TimelineItem | null;
  prev: TimelineItem | null;
  timestamp: Date;
  relatedItems?: TimelineItem[] = [];

  x: number;
  cx: number = 0;
  cy: number = 0;

  centerTimestamp: Date;
  k: number = 0;
  clustered: number;
  indexes: number[] = [];

  formattedPostTimestamp: string;
  formattedAltPostTimestamp: string;
  formattedAuthors: string;
}

export class ChronomapDatabase extends BaserowDatabase {

  id: string;
  directoryId: number;
  slug = signal<string>('');
  editor_name = signal<string>('');
  editor_email = signal<string>('');
  pitch = signal<string>('');
  title = signal<string>('');
  subtitle = signal<string>('');
  infobarTitle = signal<string>('');
  infobarSubtitle = signal<string>('');
  infobarContent = signal<string>('');
  contributeMessage = signal<string>('');
  mapView = signal<string>('');
  logo = signal<string>('');
  thumbnail = signal<string>('');
  parentLink = signal<string>('..');
  showTooltips = signal<boolean>(true);
  altTimestampLabel = signal<string>('');
  postDateFormat = signal<string>('');
  altDateFormat = signal<string>('');
  primaryColor = signal<string>('');
  secondaryColor = signal<string>('');
  newEntryForm = signal<string>('');

  // Feature Flags
  disableTimeline = signal<boolean>(false);
  imageItemMarkers = signal<boolean>(true);
  nextBackTitlesLightbox = signal<boolean>(false);

  // MapBox
  mapStyle = signal<string>('');
  backgroundMapStyle = signal<string>('');
  mapboxKey = signal<string>('');
  mapTitle = signal<string | null>(null);
  backgroundMapTitle = signal<string | null>(null);

  // Leaflet
  Map_BG = signal<string>('');
  Map_BG_Bounds = signal<string>('');
  HotSpotsGeoJson = signal<any>(null);

  timelineItems = signal<TimelineItem[]>([]);

  lastModified = signal<Date>(new Date());
  minDate = signal<Date>(new Date());
  maxDate = signal<Date>(new Date());
  allLayers: string[] = [];
  nonces: string[] = [];
  allContentItems: ContentItem[];
  authors = signal<{[key: string]: Author}>({});

  ready = new ReplaySubject<boolean>(1);
  ready_ = false;

  constructor(directoryId: number, chronomap: any, http: HttpClient) {
    super(BASEROW_ENDPOINT, chronomap.Database_Token, chronomap.Database_ID, http);
    this.id = chronomap.id;
    this.directoryId = directoryId;
    this.title.set(chronomap.Title);
    this.slug.set(chronomap.URL_Slug);
    this.editor_name.set(chronomap.Editor_Name);
    this.editor_email.set(chronomap.Editor_Email);
    this.pitch.set(chronomap.Pitch);
  }

  fetchMeta() {
    return this.fetchTables().pipe(
      tap(() => {
        this.getTable('Settings').subscribe((settingsTable) => {
          const keyValues: any = {};
          settingsTable?.rows.forEach((element: any) => {
            keyValues[element.Key] = {value: element.Value, images: element.Image};
          });
          if (keyValues.Title?.value && keyValues.Title?.value !== 'New Chronomap') {
            this.title.set(keyValues.Title?.value || '');
          }
          this.subtitle.set(keyValues.Subtitle?.value || '');
          this.infobarTitle.set(keyValues.Infobar_Title?.value || this.title());
          this.infobarSubtitle.set(keyValues.Infobar_Subtitle?.value || this.subtitle());
          this.infobarContent.set(keyValues.Infobar_Content?.value || '');
          this.contributeMessage.set(keyValues.Contribute_Message?.value || '');
          this.mapView.set(keyValues.Default_Map_View?.value || '');
          this.logo.set(keyValues.Logo?.images?.[0]?.url || '');
          this.thumbnail.set(keyValues.Thumbnail?.images?.[0]?.url || '');
          this.parentLink.set(keyValues.Parent_Link?.value || '..');
          this.mapStyle.set(keyValues.Map_Style?.value || '');
          this.backgroundMapStyle.set(keyValues.Background_Map_Style?.value || '');
          this.mapboxKey.set(keyValues.Mapbox_Key?.value || '');
          this.showTooltips.set(keyValues.Show_Tooltips?.value === 'true');
          this.altTimestampLabel.set(keyValues.Alt_Timestamp_Label?.value || '');
          this.postDateFormat.set(keyValues.Post_Date_Format?.value || '');
          this.altDateFormat.set(keyValues.Alt_Date_Format?.value || '');
          this.primaryColor.set(keyValues.Primary_Color?.value || '');
          this.secondaryColor.set(keyValues.Secondary_Color?.value || '');
          this.newEntryForm.set(keyValues.New_Entry_Form?.value || '');
          this.Map_BG.set(keyValues.Map_BG?.images?.[0]?.url || '');
          this.Map_BG_Bounds.set(keyValues.Map_BG_Bounds?.value || '');
          this.disableTimeline.set(keyValues.Disable_Timeline?.value === 'true');
          this.imageItemMarkers.set(keyValues.Image_Item_Markers?.value === 'true');

          this.nextBackTitlesLightbox.set(keyValues.Next_Back_Titles_Lightbox?.value === 'true');
          this.mapTitle.set(keyValues.Map_Title?.value || null);
          this.backgroundMapTitle.set(keyValues.Background_Map_Title?.value || null);

          if (keyValues.HotSpotsGeoJson?.value) {
            try {
              this.HotSpotsGeoJson.set(JSON.parse(keyValues.HotSpotsGeoJson.value));
            } catch (e) {
              this.HotSpotsGeoJson.set(null);
            }
          } else {
            this.HotSpotsGeoJson.set(null);
          }
        });    
      }),
    );
  }

  fetchContent(force = false): Observable<any> {
    if (this.ready_ && !force) {
      return this.ready;
    }
    console.log('FETCH CONTENT', this.title(), this.ready_, force);
    this.ready_ = true;
    return forkJoin([
      this.getTable('MapLayers'),
      this.getTable('Authors'),
      this.getTable('Content', force),
    ]).pipe(
      map(([mapLayersTable, authorsTable, contentTable]) => {
        this.allLayers = [];
        const layers: any = {};
        mapLayersTable?.rows.forEach((row: any) => {
          const onLayers = row.On_Layers.map((x : any) => x.value) || [];
          onLayers.forEach((layer: string) => {
            if (!this.allLayers.includes(layer)) {
              this.allLayers.push(layer);
            }
          });
          layers[row.Name] = onLayers;
        });
        const authors: any = {};
        authorsTable?.rows.forEach((row: any) => {
          authors[row.Name] = {
            name: row.Name,
            email: row.Email,
            status: row.Status?.value,
          };
        });
        this.authors.set(authors);
        this.nonces = [];
        const contentItems: ContentItem[] = [];
        contentTable?.rows.forEach((row: any) => {
          const item: any = {
            id: row.id,
            title: row.Title,
            notes: row.Notes,
            post_timestamp: row.Post_Timestamp ? dayjs(row.Post_Timestamp).toDate() : null,
            status: row.Status?.value,
            type: row.Type?.value,
            youtube_video_id: row.Youtube_Video_Id,
            content: row.Content,
            image: row.Image?.[0]?.url,
            audio: row.Audio?.[0]?.url,
            name: row.Name || 'Full Name',
            username: row.Username || 'username',
            profile_image: row.Profile_Image?.[0]?.url || '/assets/img/default-profile-img.svg',
            like_count: row.Like_Count || 0,
            comment_count: row.Comment_Count || 0,
            link_title: row.Link_Title,
            link_domain: row.Link_Domain,
            geo: row.Geo,
            map_layers: [],
            off_map_layers: [],
            nonce: row.Nonce,
            authors: row.Authors?.map((x: any) => authors[x.value]) || [],
            tags: row.Tags?.map((x: any) => x.value) || [],
            related: row.Related,
            lastModified: dayjs(row.Last_Modified).toDate(),
          };
          try {
            item.extraProperties = row.Properties ? JSON.parse(row.Properties) : {};
          } catch (e) {
            item.extraProperties = {};
          }
          item.extraProperties = Object.keys(item.extraProperties).map((key) => [key, item.extraProperties[key]]);
          item.alt_post_timestamp = row.Alt_Post_Timestamp ? dayjs(row.Alt_Post_Timestamp).toDate() : item.post_timestamp;
          row.Map_Layer.forEach((x: any) => {
            const name = x.value;
            if (layers[name]) {
              layers[name].forEach((layer: string) => {
                if (!item.map_layers.includes(layer)) {
                  item.map_layers.push(layer);
                }
              });
            }
          });
          this.allLayers.forEach((layer: string) => {
            if (!item.map_layers.includes(layer)) {
              item.off_map_layers.push(layer);
            }
          });
          if (!!item.nonce) {
            this.nonces.push(item.nonce);
          }

          const contentItem: ContentItem = item;
          if (contentItem.status !== 'Published') { return; }
          if (!contentItem.authors.find((author: Author) => author.status === 'Editor' || author.status === 'Contributor')) { return; }
          if (!this.disableTimeline() && !contentItem.post_timestamp && !contentItem.alt_post_timestamp) { return; }
          contentItems.push(contentItem);
        });
        contentItems.forEach((item: ContentItem) => {
          item.related = item.related.map((id: ContentItem) => (contentItems.find((i: ContentItem) => i.id === id.id) || {}) as ContentItem).filter((i: ContentItem) => !!i.id);
        });
        if (this.disableTimeline()) {
          return contentItems.sort((a: ContentItem, b: ContentItem) => (MapUtils.parseMapView(a.geo).center?.lon || 0) - (MapUtils.parseMapView(b.geo).center?.lon || 0));
        } else {
          return contentItems.sort((a: ContentItem, b: ContentItem) => a.post_timestamp.getTime() - b.post_timestamp.getTime());
        }
      }),
      tap((contentItems: ContentItem[]) => {
        this.allContentItems = contentItems;

        const timelineItems: TimelineItem[] = contentItems.map((item: ContentItem, index: number) => {
          const ti = new TimelineItem();
          Object.assign(ti, item);
          if (!this.disableTimeline()) {
            ti.timestamp = ti.post_timestamp || ti.alt_post_timestamp;
            ti.formattedPostTimestamp = (FORMATTERS[this.postDateFormat()] || FORMATTERS['year'])(item.post_timestamp);
            ti.formattedAltPostTimestamp = (FORMATTERS[this.altTimestampLabel()] || FORMATTERS['year'])(item.alt_post_timestamp);
          }
          const authorNames = ti.authors.map((author: Author) => author.name);
          if (authorNames.length > 1) {
            const last = authorNames.pop();
            authorNames[authorNames.length - 1] += ` and ${last}`;
          }
          ti.formattedAuthors = authorNames.join(', ');
          return ti;
        });
        let minDate: Date|null = null;
        let maxDate: Date|null = null;
        timelineItems.forEach((item: TimelineItem, index: number) => {
          item.index = index;
          item.next = timelineItems[index + 1] || null;
          item.prev = timelineItems[index - 1] || null;
          if (item.post_timestamp) {
            if (!minDate || item.post_timestamp < minDate) {
              minDate = item.post_timestamp;
            }
            if (!maxDate || item.post_timestamp > maxDate) {
              maxDate = item.post_timestamp;
            }
          }
          item.relatedItems = item.related
              .map((ci: ContentItem) => (timelineItems.find((i: TimelineItem) => i.id === ci.id) || {}) as TimelineItem)
              .filter((i: TimelineItem) => !!i);
        });
        minDate = minDate || new Date();
        maxDate = maxDate || new Date();
        const delta = (maxDate.getTime() - minDate.getTime()) / 10;
        this.minDate.set(new Date(minDate.getTime() - delta));
        this.maxDate.set(new Date(maxDate.getTime() + delta));
        this.lastModified.set(timelineItems.map(x => x.lastModified).reduce((a, b) => a > b ? a : b, new Date(1970, 1, 1)));
        this.timelineItems.set(timelineItems);
        console.log('GOT CONTENT ITEMS', this.title(), timelineItems.length, this.allContentItems.length);
        this.ready.next(true);
        this.ready.complete();
      })
    );
  }
}


export class DirectoryDatabase extends BaserowDatabase {

  chronomaps = signal<ChronomapDatabase[]>([]);
  title = signal<string>('');
  subtitle = signal<string>('');
  titleImageUrl = signal<string>('');
  description = signal<string>('');
  fullDescription = signal<string>('');
  logos = signal<string[]>([]);
  logoLinks = signal<string[]>([]);
  primaryColor = signal<string>('#000000');
  secondaryColor = signal<string>('#ffffff');
  zoomFrom = signal<number>(1900);
  zoomUntil = signal<number>(2100);
  url = signal<string>('');

  constructor(dbId: number, http: HttpClient) {
    super(BASEROW_ENDPOINT, BASEROW_ADMIN_TOKEN, dbId, http);
  }

  fetchMaps() {
    this.fetchTables().subscribe();
    this.getTable('Settings').subscribe((settingsTable) => {
      const keyValues: any = {};
      settingsTable?.rows.forEach((element: any) => {
        keyValues[element.Key] = {value: element.Value, images: element.Image};
      });
      this.title.set(keyValues.Title?.value || '');
      this.subtitle.set(keyValues.Subtitle?.value || '');
      this.titleImageUrl.set(keyValues.Title_Image?.images?.[0]?.url || '');
      this.description.set(keyValues.Description.value);
      this.fullDescription.set(keyValues.Full_Description.value);
      this.logos.set((keyValues.Logos?.images || []).map((i: any) => i.url));
      this.logoLinks.set(keyValues.Logos?.value?.split(',') || []);
      this.primaryColor.set(keyValues.Primary_Color.value);
      this.secondaryColor.set(keyValues.Secondary_Color.value);
      this.zoomFrom.set(keyValues.Zoom_From.value);
      this.zoomUntil.set(keyValues.Zoom_Until.value);
      this.url.set(keyValues.URL.value);
    });
    this.getTable('Chronomaps').subscribe((chronomapsTable) => {
      this.chronomaps.set(chronomapsTable?.rows.filter(row => row.Status?.value === 'Published').map((chronomap: any) => {
        const map = new ChronomapDatabase(this.database, chronomap, this.http);        
        return map;
      }) || []);
      // forkJoin([...this.chronomaps().map(map => map.fetchMeta())]).subscribe((maps) => {
      //   console.log('all maps loaded');
      //   // const byUpdateTime = this.chronomaps().sort((a, b) => b.lastModified().getTime() - a.lastModified().getTime());
      //   // this.chronomaps.set(byUpdateTime);
      // });
    });
  }
}


@Injectable({
  providedIn: 'root'
})
export class DataService {

  directory: DirectoryDatabase;
  currentDbId: number = 0;

  constructor(private http: HttpClient) {
  }

  fetchData(dbId: number) {
    if (this.currentDbId === dbId) {
      return;
    }
    console.log('fetching data for', dbId);
    this.currentDbId = dbId;
    this.directory = new DirectoryDatabase(dbId, this.http);
    this.directory.fetchMaps();
  }
}
