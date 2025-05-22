import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import fetch from 'node-fetch';
import { FilesService } from '@directus/api/services/files';

export default {
    id: 'zipfiles',
    handler: (router, { getSchema }) => {
        router.post('/', async (req, res) => {
            try {
                const { fileIds } = req.body;
                if (!Array.isArray(fileIds) || fileIds.length === 0) {
                    return res.status(400).json({ error: 'No file IDs provided.' });
                }

                // Set Directus base URL once at the top-level scope for efficiency
                const directusBaseUrl = req.directus?.url || process.env.DIRECTUS_BASE_URL || 'https://cms.elsasser.cloud';

                let filesAdded = 0;
                const fileErrors = [];

                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', 'attachment; filename=files.zip');

                const archive = archiver('zip', { zlib: { level: 9 } });
                archive.on('error', err => {
                    if (!res.headersSent) {
                        res.status(500).send({ error: err.message });
                    } else {
                        res.end();
                    }
                });
                archive.pipe(res);

                for (const fileId of fileIds) {
                    try {
                        const url = `${directusBaseUrl}/assets/${fileId}?download`;
                        const response = await fetch(url, {
                            headers: {
                                // Forward the user's auth token if needed
                                authorization: req.headers.authorization
                            }
                        });
                        if (!response.ok) {
                            throw new Error(`Failed to fetch file: ${response.statusText}`);
                        }
                        archive.append(response.body, { name: `${fileId}` });
                        filesAdded++;
                    } catch (err) {
                        fileErrors.push({
                            id: fileId,
                            error: `Could not fetch file: ${err.message}`
                        });
                    }
                }

                if (filesAdded === 0) {
                    archive.abort();
                    return res.status(404).json({
                        error: 'None of the requested files could be fetched.',
                        details: fileErrors
                    });
                }

                archive.finalize();
            } catch (err) {
                res.status(500).json({ error: 'Internal server error', details: err.message });
            }
        });

        // Add the test route here
        router.get('/test', async (req, res) => {
            const schema = await getSchema();
            const filesService = new FilesService({ schema, accountability: req.accountability });
            res.json({
                getAssetType: typeof filesService.getAsset,
                filesServiceKeys: Object.keys(filesService)
            });
        });

        return router;
    },
};
