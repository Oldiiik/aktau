// Photos from the camera or gallery, resized in the browser before upload:
// the full image (≤1280 px JPEG) for the server, a tiny thumbnail for the UI.
export type PhotoUpload = { media_type: 'image/jpeg'; data: string }

export async function preparePhoto(file: File): Promise<{ image: PhotoUpload; thumb: string }> {
  const bmp = await createImageBitmap(file)
  const draw = (max: number, q: number) => {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', q)
  }
  const full = draw(1280, 0.82)
  return { image: { media_type: 'image/jpeg', data: full.slice(full.indexOf(',') + 1) }, thumb: draw(240, 0.7) }
}
