import type { MessageContentGenerationOptions, WAMessageKey } from '../../Types'
import { generateWAMessageContent } from '../../Utils/messages'

const options: MessageContentGenerationOptions = {
	upload: async () => ({
		mediaUrl: 'https://example.com/media',
		directPath: '/media'
	})
}

describe('generateWAMessageContent flexible proto input', () => {
	it('passes through any generated WAProto message type', async () => {
		const result = await generateWAMessageContent(
			{
				protoMessage: {
					extendedTextMessage: { text: 'future-compatible content' }
				}
			},
			options
		)

		expect(result.extendedTextMessage?.text).toBe('future-compatible content')
	})

	it('applies standard wrappers to raw proto content', async () => {
		const editKey: WAMessageKey = { remoteJid: '123@s.whatsapp.net', id: 'message-id' }
		const result = await generateWAMessageContent(
			{
				protoMessage: {
					extendedTextMessage: { text: 'wrapped content' }
				},
				mentions: ['456@s.whatsapp.net'],
				contextInfo: { forwardingScore: 1 },
				viewOnce: true,
				edit: editKey
			},
			options
		)

		expect(result.protocolMessage?.editedMessage?.viewOnceMessage?.message?.extendedTextMessage?.text).toBe(
			'wrapped content'
		)
		expect(result.protocolMessage?.editedMessage?.viewOnceMessage?.message?.extendedTextMessage?.contextInfo).toEqual(
			expect.objectContaining({
				forwardingScore: 1,
				mentionedJid: ['456@s.whatsapp.net']
			})
		)
	})
})
