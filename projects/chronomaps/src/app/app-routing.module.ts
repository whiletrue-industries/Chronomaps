import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DirectoryPageComponent } from './directory-page/directory-page.component';
import { ChronomapPageComponent } from './chronomap-page/chronomap-page.component';
import { AppComponent } from './app.component';
import { HomepageComponent } from './homepage/homepage.component';

const routes: Routes = [
  {path: ':dbid/:slug', component: ChronomapPageComponent},
  {path: ':dbid', component: DirectoryPageComponent},
  {path: '', component: HomepageComponent},
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
