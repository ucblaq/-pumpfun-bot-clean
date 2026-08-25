const PINATA_JWT = process.env.PINATA_JWT;

async function uploadFile(buffer, filename, contentType) {
  if (!PINATA_JWT) {
    throw new Error('PINATA_JWT is not set.');
  }

  const form = new FormData();
  form.append('network', 'public');
  form.append('file', new Blob([buffer], { type: contentType }), filename);

  const res = await fetch('https://uploads.pinata.cloud/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Pinata upload failed (${res.status}): ${await res.text()}`);
  }

  const json = await res.json();
  return json.data.cid;
}

export async function uploadTokenMetadata({
  imageBuffer,
  imageFilename,
  name,
  symbol,
  description,
  twitter,
  telegram,
  website,
}) {
  const imageCid = await uploadFile(imageBuffer, imageFilename, 'image/png');
  const image = `https://ipfs.io/ipfs/${imageCid}`;

  const metadata = {
    name,
    symbol,
    image,
    description,
    ...(twitter ? { twitter } : {}),
    ...(telegram ? { telegram } : {}),
    ...(website ? { website } : {}),
  };

  const metadataBuffer = Buffer.from(JSON.stringify(metadata));
  const metadataCid = await uploadFile(metadataBuffer, 'metadata.json', 'application/json');

  return `https://ipfs.io/ipfs/${metadataCid}`;
}
