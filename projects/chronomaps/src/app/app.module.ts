import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ChronomapPageComponent } from './chronomap-page/chronomap-page.component';
import { InfobarComponent } from './chronomap-page/infobar/infobar.component';
import { ContentAudioComponent } from './content/content-audio/content-audio.component';
import { ContentVideoComponent } from './content/content-video/content-video.component';
import { ContentImageComponent } from './content/content-image/content-image.component';
import { ContentTwitterComponent } from './content/content-twitter/content-twitter.component';
import { ContentInstagramComponent } from './content/content-instagram/content-instagram.component';
import { ContentWikipediaComponent } from './content/content-wikipedia/content-wikipedia.component';
import { AudioPlayerComponent } from './content/content-audio/audio-player/audio-player.component';
import { HttpClientModule } from '@angular/common/http';
import { AddNewBarComponent } from './chronomap-page/add-new-bar/add-new-bar.component';
import { FormsModule } from '@angular/forms';
import { MapSelectorComponent } from './chronomap-page/map-selector/map-selector.component';
import { LayersBarComponent } from './layers-bar/layers-bar.component';
import { LayersBarItemComponent } from './layers-bar/layers-bar-item/layers-bar-item.component';
import { TimeLineComponent } from './time-line/time-line.component';
import { ContentItemComponent } from './content/content-item/content-item.component';
import { MediaIconComponent } from './media-icon/media-icon.component';
import { DirectoryPageComponent } from './directory-page/directory-page.component';
import { DirectoryItemComponent } from './directory-page/directory-item/directory-item.component';
import { ChronomapComponent } from './chronomap/chronomap.component';

@NgModule({
  declarations: [
    AppComponent,
    ChronomapPageComponent,
    InfobarComponent,
    ContentAudioComponent,
    ContentVideoComponent,
    ContentImageComponent,
    ContentTwitterComponent,
    ContentInstagramComponent,
    ContentWikipediaComponent,
    AudioPlayerComponent,
    AddNewBarComponent,
    LayersBarComponent,
    MapSelectorComponent,
    LayersBarItemComponent,
    ChronomapComponent,
    TimeLineComponent,
    ContentItemComponent,
    MediaIconComponent,
    DirectoryPageComponent,
    DirectoryItemComponent,
    
  ],
  imports: [
    BrowserModule,
    HttpClientModule,
    FormsModule,
    AppRoutingModule,
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
