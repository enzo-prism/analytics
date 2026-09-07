import { expect, test } from '@playwright/test';
import { TRACKED_PROJECTS, trackedProjectId } from '../src/lib/tracked-projects';
import { mergeTrackedProjects } from '../src/lib/portfolio';

const projects = TRACKED_PROJECTS.map(p => ({ propertyId: trackedProjectId(p), displayName: p.name, defaultUri: p.url, emoji: '', source: p.gaPropertyId ? 'ga4' as const : 'vercel' as const, metric: p.gaPropertyId ? 'newUsers' as const : 'visitors' as const, newUsers: p.slug === 'midas' ? null : { current: 13, previous: 5, delta: 8, pct: 1.6 }, error: p.slug === 'midas' ? 'Vercel Analytics is not enabled for this project.' : null }));

test('selected Vercel source replaces an automatically discovered GA duplicate', () => {
 const duplicate = { ...projects[2], propertyId: '999', defaultUri: 'https://www.marble-fit.app/' };
 const rows = mergeTrackedProjects([projects[0], duplicate], projects.slice(1));
 expect(rows).toHaveLength(6);
 expect(rows.filter(p => p.displayName === 'Marble')).toHaveLength(1);
 expect(rows.find(p => p.displayName === 'Marble')?.source).toBe('vercel');
});

test('My projects includes all six and preserves unavailable tracking without false zeros', async ({page}) => {
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/dashboard?**', route => route.fulfill({json:{updatedAt:new Date().toISOString(),window:'d7',properties:[...projects,{...projects[0],propertyId:'123',displayName:'Other website'}]}}));
 await page.goto('/');
 await expect(page.getByRole('link',{name:'Open Other website analytics'})).toBeVisible();
 await page.getByRole('button',{name:'My projects',exact:true}).click();
 await expect(page.getByTestId('property-card')).toHaveCount(6);
 await expect(page.getByRole('link',{name:'Open Other website analytics'})).toHaveCount(0);
 const marble = page.getByRole('link',{name:'Open Marble analytics'});
 await expect(marble).toContainText('Visitors');
 await expect(marble).toContainText('Vercel Analytics');
 const midas = page.getByRole('link',{name:'Open Midas analytics'});
 await expect(midas).toContainText('n/a');
 await expect(midas).toContainText('not enabled');
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Vercel detail labels and errors remain source-specific', async ({page}) => {
 await page.route('**/api/properties/vercel-marble?**', route => route.fulfill({json:{updatedAt:new Date().toISOString(),window:'d7',property:projects[2],summary:projects[2].newUsers,series:[{date:'2026-09-05',current:13,previous:5}],error:null}}));
 await page.goto('/properties/vercel-marble?window=d7');
 await expect(page.getByRole('heading',{name:'Visitors trend'})).toBeVisible();
 await expect(page.getByLabel('13 visitors', {exact:true})).toBeVisible();
 await page.route('**/api/properties/vercel-midas?**', route => route.fulfill({json:{updatedAt:new Date().toISOString(),window:'d7',property:projects[3],summary:null,series:[],error:'Vercel Analytics is not enabled for this project.'}}));
 await page.goto('/properties/vercel-midas?window=d7');
 await expect(page.getByText('Vercel Analytics is not enabled for this project.',{exact:true})).toBeVisible();
});
