import { expect, test } from '@playwright/test';
import { active, backHome, openData, openFreshApp } from './helpers';

// Two 80×40 solid-color frames created with Pillow solely for this test.
const gif =
  'R0lGODlhUAAoAIEAAGm90QAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAGQAAACwAAAAAUAAoAAAIXQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTpygDAgAh+QQAGQAAACwAAAAAUAAoAIHvoFsAAAAAAAAAAAAIXQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTpygDAgA7';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAIAAADmAupWAAAATklEQVR4nO3PAQ3AIADAMMAtIhGBo7v4k71VsM197viT9XXA2wzXGa4zXGe4znCd4TrDdYbrDNcZrjNcZ7jOcJ3hOsN1husM1xmuM1z3AAVaAkcuZhAxAAAAAElFTkSuQmCC';

test('静态和动态首页背景持久化，取消/坏文件不改现有背景', async ({ page }) => {
  await openFreshApp(page);
  await openData(page);
  const input = active(page).getByLabel('选择首页背景图片', { exact: true });
  await input.setInputFiles({
    name: 'fictional.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from(gif, 'base64'),
  });
  await active(page).getByRole('button', { name: '应用首页背景', exact: true }).click();
  await backHome(page);
  const image = active(page).locator('.lj-dashboard-hero .lj-home-background');
  await expect(image).toHaveAttribute('src', `data:image/gif;base64,${gif}`);
  await expect(image).toBeVisible();
  const frames = new Set<string>();
  for (let index = 0; index < 4; index++) {
    frames.add((await image.screenshot()).toString('base64'));
    await page.waitForTimeout(140);
  }
  expect(frames.size).toBeGreaterThan(1);
  await page.screenshot({ path: '.tools/background-home.png' });
  await page.reload();
  await expect(image).toHaveAttribute('src', `data:image/gif;base64,${gif}`);
  await openData(page);
  await input.setInputFiles({
    name: 'fictional.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await active(page).getByRole('button', { name: '取消预览', exact: true }).click();
  await input.setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('broken image'),
  });
  await expect(active(page).getByRole('alert')).toContainText('支持 JPG');
  await backHome(page);
  await expect(image).toHaveAttribute('src', `data:image/gif;base64,${gif}`);
  await openData(page);
  await input.setInputFiles({
    name: 'fictional.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await active(page).getByLabel('背景显示方式').selectOption('contain');
  await active(page).getByRole('button', { name: '应用首页背景', exact: true }).click();
  await backHome(page);
  await expect(image).toHaveAttribute('src', `data:image/png;base64,${png}`);
  await expect(image).toHaveCSS('object-fit', 'contain');
  await openData(page);
  await active(page).getByRole('button', { name: '恢复默认背景', exact: true }).click();
  await backHome(page);
  await expect(image).toHaveCount(0);
});
