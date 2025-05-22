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

                const directusBaseUrl = req.directus?.url || process.env.DIRECTUS_BASE_URL || 'https://cms.elsasser.cloud';

                let filesAdded = 0;
                const fileErrors = [];

                // Fetch file metadata from Directus
                const schema = await getSchema();
                const filesService = new FilesService({ schema, accountability: req.accountability });
                const files = await filesService.readByQuery({ filter: { id: { _in: fileIds } } });

                // Map file IDs to metadata for easy lookup
                const fileMap = {};
                for (const file of files) {
                    fileMap[file.id] = file;
                }

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
                    const fileMeta = fileMap[fileId];
                    if (!fileMeta) {
                        fileErrors.push({
                            id: fileId,
                            error: 'File metadata not found'
                        });
                        continue;
                    }
                    try {
                        const url = `${directusBaseUrl}/assets/${fileId}?download`;
                        const response = await fetch(url, {
                            headers: {
                                authorization: req.headers.authorization
                            }
                        });
                        if (!response.ok) {
                            throw new Error(`Failed to fetch file: ${response.statusText}`);
                        }
                        // Use the original filename for the zip entry
                        archive.append(response.body, { name: fileMeta.filename_download || fileMeta.filename_disk });
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
