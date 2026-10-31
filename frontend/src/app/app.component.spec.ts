import { Auth, User } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { ApiService } from './api.service';
import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { GardenComponent } from './garden/garden.component';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      deferBlockBehavior: DeferBlockBehavior.Manual,
      providers: [
        { provide: Auth, useValue: {
          currentUser: null,
          onIdTokenChanged: (next: (value: null) => void) => { next(null); return () => {}; }
        } },
        { provide: Firestore, useValue: {} },
        { provide: ApiService, useValue: { getMemories: () => of([]), getLatestInsight: () => of(null) } }
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('makes poster export available with the signed-in garden', async () => {
    spyOn(GardenComponent.prototype, 'ngAfterViewInit');
    spyOn(GardenComponent.prototype, 'ngOnDestroy');
    const exportPoster = spyOn(GardenComponent.prototype, 'exportAsPoster');
    const fixture = TestBed.createComponent(AppComponent);
    const root: HTMLElement = fixture.nativeElement;
    fixture.componentInstance.user = of(null);
    fixture.detectChanges();
    expect(await fixture.getDeferBlocks()).toHaveSize(0);

    fixture.componentInstance.user = of(jasmine.createSpyObj<User>('user', [], { displayName: 'Gardener' }));
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    const [garden] = await fixture.getDeferBlocks();
    expect(root.textContent).not.toContain('Export Garden as Poster');
    await garden.render(DeferBlockState.Complete);
    const button = Array.from(root.querySelectorAll('button'))
      .find(candidate => candidate.textContent.includes('Export Garden as Poster'));
    expect(button).toBeDefined();
    button?.click();
    expect(exportPoster).toHaveBeenCalledTimes(1);
  });
});
