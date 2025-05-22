import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

export default {
    id: 'zipfiles',
    handler: (router, { services, getSchema }) => {
        const { FilesService } = services;

        router.post('/', async (req, res) => {
            try {
                const { fileIds } = req.body;
                if (!Array.isArray(fileIds) || fileIds.length === 0) {
                    return res.status(400).json({ error: 'No file IDs provided.' });
                }

                const schema = await getSchema();
                const filesService = new FilesService({
                    schema,
                    accountability: req.accountability // if available in your context
                });

                const files = await filesService.readByQuery({ filter: { id: { _in: fileIds } } });

                if (!files.length) {
                    return res.status(404).json({ error: 'No files found for provided IDs.' });
                }

                // Prepare to collect errors
                let filesAdded = 0;
                const fileErrors = [];
                const streams = [];

                for (const file of files) {
                    try {
                        if (typeof filesService.getAsset !== 'function') {
                            throw new Error('Please check your Directus version. You are likely using a version older than 10.10.0.');
                        }
                        const stream = await filesService.getAsset(file.id);
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

                // Set headers before streaming
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

        return router;
    },
};
