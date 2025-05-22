import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
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

                const schema = await getSchema();
                const filesService = new FilesService({
                    schema,
                    accountability: req.accountability || {}
                });

                const files = await filesService.readByQuery({ filter: { id: { _in: fileIds } } });

                if (!files.length) {
                    return res.status(404).json({ error: 'No files found for provided IDs.' });
                }

                let filesAdded = 0;
                const fileErrors = [];
                const streams = [];

                // Use the storage driver from the request context
                const storage = req.storage;
                if (!storage || typeof storage.getReadStream !== 'function') {
                    return res.status(500).json({
                        error: 'Storage driver is not available in the request context.'
                    });
                }

                for (const file of files) {
                    try {
                        const stream = await storage.getReadStream(file.filename_disk);
                        stream.on('error', (err) => {
                            fileErrors.push({
                                id: file.id,
                                error: `Stream error: ${err.message}`
                            });
                        });
                        streams.push({ stream, name: file.filename_download || file.filename_disk });
                        filesAdded++;
                    } catch (err) {
                        fileErrors.push({
                            id: file.id,
                            error: `Could not stream file: ${err.message}`
                        });
                    }
                }

                if (filesAdded === 0) {
                    return res.status(404).json({
                        error: 'None of the requested files could be streamed.',
                        details: fileErrors
                    });
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

                for (const { stream, name } of streams) {
                    stream.resume();
                    archive.append(stream, { name });
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
