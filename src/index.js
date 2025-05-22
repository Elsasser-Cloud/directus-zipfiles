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
                const filesService = new FilesService({ schema });

                const files = await filesService.readByQuery({ filter: { id: { _in: fileIds } } });

                if (!files.length) {
                    return res.status(404).json({ error: 'No files found for provided IDs.' });
                }

                // Set headers before streaming
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', 'attachment; filename=files.zip');

                const archive = archiver('zip', { zlib: { level: 9 } });
                archive.on('error', err => {
                    console.error('Archiver error:', err);
                    if (!res.headersSent) {
                        res.status(500).send({ error: err.message });
                    } else {
                        res.end();
                    }
                });
                archive.pipe(res);

                let filesAdded = 0;
                for (const file of files) {
                    try {
                        console.log('Attempting to stream file:', file.id, file.filename_disk, file.filename_download);
                        const stream = await filesService.getAsset(file.id);

                        // Ensure the stream is in flowing mode
                        stream.on('error', (err) => {
                            console.warn(`Stream error for file ${file.id}:`, err);
                        });
                        // This will put the stream in flowing mode
                        stream.resume();

                        archive.append(stream, { name: file.filename_download || file.filename_disk });
                        filesAdded++;
                    } catch (err) {
                        console.warn(`Could not stream file ${file.id}:`, err);
                    }
                }

                if (filesAdded === 0) {
                    archive.abort();
                    return res.status(404).json({ error: 'None of the requested files could be streamed.' });
                }

                archive.finalize();
            } catch (err) {
                console.error('Unexpected error:', err);
                res.status(500).json({ error: 'Internal server error', details: err.message });
            }
        });

        return router;
    },
};
