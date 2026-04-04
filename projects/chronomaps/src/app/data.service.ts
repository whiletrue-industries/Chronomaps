import { Injectable, signal } from '@angular/core';

import { CHRONOMAPS_API_ENDPOINT } from 'CONFIGURATION';
import { ChronomapsApi } from './api/chronomaps-api';
import { HttpClient } from '@angular/common/http';
import { Observable, ReplaySubject, forkJoin, from, map, switchMap, tap } from 'rxjs';
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

export class ChronomapDatabase {

  id: string;
  directoryId: number;
  workspaceId: string;
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
  currentTitleLightbox = signal<boolean>(false);

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

  private mapLayersData: any[] = [];
  private authorsData: any[] = [];

  constructor(directoryId: number, chronomapItem: any, private api: ChronomapsApi) {
    this.id = chronomapItem._id;
    this.directoryId = directoryId;
    this.workspaceId = chronomapItem.Workspace_ID || '';
    this.title.set(chronomapItem.Title || '');
    this.slug.set(chronomapItem.URL_Slug || chronomapItem._id || '');
    this.editor_name.set(chronomapItem.Editor_Name || '');
    this.editor_email.set(chronomapItem.Editor_Email || '');
    this.pitch.set(chronomapItem.Pitch || '');
  }

  fetchMeta() {
    return this.api.getWorkspace(this.workspaceId).pipe(
      tap((workspace: any) => {
        const meta = workspace;
        if (meta.Title && meta.Title !== 'New Chronomap') {
          this.title.set(meta.Title || '');
        }
        this.subtitle.set(meta.Subtitle || '');
        this.infobarTitle.set(meta.Infobar_Title || this.title());
        this.infobarSubtitle.set(meta.Infobar_Subtitle || this.subtitle());
        this.infobarContent.set(meta.Infobar_Content || '');
        this.contributeMessage.set(meta.Contribute_Message || '');
        this.mapView.set(meta.Default_Map_View || '');
        this.logo.set(meta.Logo || '');
        this.thumbnail.set(meta.Thumbnail || '');
        this.parentLink.set(meta.Parent_Link || '..');
        this.mapStyle.set(meta.Map_Style || '');
        this.backgroundMapStyle.set(meta.Background_Map_Style || '');
        this.mapboxKey.set(meta.Mapbox_Key || '');
        this.showTooltips.set(meta.Show_Tooltips === 'true');
        this.altTimestampLabel.set(meta.Alt_Timestamp_Label || '');
        this.postDateFormat.set(meta.Post_Date_Format || '');
        this.altDateFormat.set(meta.Alt_Date_Format || '');
        this.primaryColor.set(meta.Primary_Color || '');
        this.secondaryColor.set(meta.Secondary_Color || '');
        this.newEntryForm.set(meta.New_Entry_Form || '');
        this.Map_BG.set(meta.Map_BG || '');
        this.Map_BG_Bounds.set(meta.Map_BG_Bounds || '');
        this.disableTimeline.set(meta.Disable_Timeline === 'true');
        this.imageItemMarkers.set(meta.Image_Item_Markers === 'true');
        this.nextBackTitlesLightbox.set(meta.Next_Back_Titles_Lightbox === 'true');
        this.currentTitleLightbox.set(meta.Current_Title_Lightbox === 'true');
        this.mapTitle.set(meta.Map_Title || null);
        this.backgroundMapTitle.set(meta.Background_Map_Title || null);

        if (meta.HotSpotsGeoJson) {
          try {
            this.HotSpotsGeoJson.set(JSON.parse(meta.HotSpotsGeoJson));
          } catch (e) {
            this.HotSpotsGeoJson.set(null);
          }
        } else {
          this.HotSpotsGeoJson.set(null);
        }

        // MapLayers and Authors stored in workspace metadata
        this.mapLayersData = meta.MapLayers || [];
        this.authorsData = meta.Authors || [];
      }),
    );
  }

  fetchContent(force = false): Observable<any> {
    if (this.ready_ && !force) {
      return this.ready;
    }
    console.log('FETCH CONTENT', this.title(), this.ready_, force);
    this.ready_ = true;
    return this.api.getItems(this.workspaceId).pipe(
      map((items: any[]) => {
        this.allLayers = [];
        const layers: any = {};
        this.mapLayersData.forEach((row: any) => {
          const onLayers = row.On_Layers || [];
          onLayers.forEach((layer: string) => {
            if (!this.allLayers.includes(layer)) {
              this.allLayers.push(layer);
            }
          });
          layers[row.Name] = onLayers;
        });
        const authors: any = {};
        this.authorsData.forEach((row: any) => {
          authors[row.Name] = {
            name: row.Name,
            email: row.Email,
            status: row.Status,
          };
        });
        this.authors.set(authors);
        this.nonces = [];
        const contentItems: ContentItem[] = [];
        items.forEach((item: any) => {
          const row = item;
          const ci: any = {
            id: row.id ?? row._id,
            title: row.Title,
            notes: row.Notes,
            post_timestamp: row.Post_Timestamp ? dayjs(row.Post_Timestamp).toDate() : null,
            status: row.Status,
            type: row.Type,
            youtube_video_id: row.Youtube_Video_Id,
            content: row.Content,
            image: row.Image,
            audio: row.Audio,
            name: row.Name || 'Full Name',
            username: row.Username || 'username',
            profile_image: row.Profile_Image || '/assets/img/default-profile-img.svg',
            like_count: row.Like_Count || 0,
            comment_count: row.Comment_Count || 0,
            link_title: row.Link_Title,
            link_domain: row.Link_Domain,
            geo: row.Geo,
            map_layers: [],
            off_map_layers: [],
            nonce: row.Nonce,
            authors: (row.Authors || []).map((x: string) => authors[x]).filter(Boolean) || [],
            tags: row.Tags || [],
            related: row.Related || [],
            lastModified: row.Last_Modified ? dayjs(row.Last_Modified).toDate() : new Date(),
          };
          try {
            ci.extraProperties = row.Properties ? JSON.parse(row.Properties) : {};
          } catch (e) {
            ci.extraProperties = {};
          }
          ci.extraProperties = Object.keys(ci.extraProperties).map((key) => [key, ci.extraProperties[key]]);
          ci.alt_post_timestamp = row.Alt_Post_Timestamp ? dayjs(row.Alt_Post_Timestamp).toDate() : ci.post_timestamp;
          (row.Map_Layer || []).forEach((name: string) => {
            if (layers[name]) {
              layers[name].forEach((layer: string) => {
                if (!ci.map_layers.includes(layer)) {
                  ci.map_layers.push(layer);
                }
              });
            }
          });
          this.allLayers.forEach((layer: string) => {
            if (!ci.map_layers.includes(layer)) {
              ci.off_map_layers.push(layer);
            }
          });
          if (!!ci.nonce) {
            this.nonces.push(ci.nonce);
          }

          const contentItem: ContentItem = ci;
          if (contentItem.status !== 'Published') { return; }
          if (!contentItem.authors.find((author: Author) => author.status === 'Editor' || author.status === 'Contributor')) { return; }
          if (!this.disableTimeline() && !contentItem.post_timestamp && !contentItem.alt_post_timestamp) { return; }
          contentItems.push(contentItem);
        });
        contentItems.forEach((item: ContentItem) => {
          item.related = item.related.map((id: any) => {
            const numId = typeof id === 'object' ? id.id : id;
            return (contentItems.find((i: ContentItem) => i.id == numId) || {}) as ContentItem;
          }).filter((i: ContentItem) => !!i.id);
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


export class DirectoryDatabase {

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

  private workspaceId: string;

  constructor(private dbId: number, private api: ChronomapsApi) {
    this.workspaceId = `chronomaps-${dbId}`;
  }

  fetchMaps() {
    forkJoin([
      this.api.getWorkspace(this.workspaceId),
      this.api.getItems(this.workspaceId),
    ]).subscribe(([workspace, items]) => {
      const meta = workspace;
      this.title.set(meta.Title || '');
      this.subtitle.set(meta.Subtitle || '');
      this.titleImageUrl.set(meta.Title_Image || '');
      this.description.set(meta.Description || '');
      this.fullDescription.set(meta.Full_Description || '');
      this.logos.set(meta.Logos || []);
      this.logoLinks.set(meta.Logo_Links ? meta.Logo_Links.split(',') : []);
      this.primaryColor.set(meta.Primary_Color || '#000000');
      this.secondaryColor.set(meta.Secondary_Color || '#ffffff');
      this.zoomFrom.set(meta.Zoom_From || 1900);
      this.zoomUntil.set(meta.Zoom_Until || 2100);
      this.url.set(meta.URL || '');

      this.chronomaps.set(
        items
          .filter((item: any) => item.Status === 'Published')
          .map((item: any) => new ChronomapDatabase(this.dbId, item, this.api))
      );
    });
  }
}


@Injectable({
  providedIn: 'root'
})
export class DataService {

  directory: DirectoryDatabase;
  currentDbId: number = 0;
  private api: ChronomapsApi;

  constructor(private http: HttpClient) {
    this.api = new ChronomapsApi(CHRONOMAPS_API_ENDPOINT, http);
  }

  fetchData(dbId: number) {
    if (this.currentDbId === dbId) {
      return;
    }
    console.log('fetching data for', dbId);
    this.currentDbId = dbId;
    this.directory = new DirectoryDatabase(dbId, this.api);
    this.directory.fetchMaps();
  }
}
